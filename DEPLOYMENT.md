# Deploying to AWS ECS (Fargate) with an ALB + NLB

## Why two load balancers

This service exposes two completely different kinds of traffic on the same
container:

| Port | Protocol | Who talks to it | Load balancer needed |
| --- | --- | --- | --- |
| `3000` (`PORT`) | HTTP | Your browser / monitoring tools | **ALB** (Application Load Balancer) |
| `6001` (`TRACKER_TCP_PORT`) | Raw TCP, `#`-delimited frames | AVT110 devices | **NLB** (Network Load Balancer, TCP passthrough) |

An ALB only understands HTTP/HTTPS - it cannot forward the tracker's raw
binary protocol. An NLB only understands TCP/TLS/UDP - it has no idea what
an HTTP route is. So this deploys **one ECS service, registered with both
load balancers**, each pointed at a different container port.

```
Internet
   │
   ├── ALB  :80/:443  ──► target group (HTTP, port 3000) ──┐
   │                                                        ├──► ECS Service (Fargate)
   └── NLB  :6001      ──► target group (TCP, port 6001) ──┘      (this container, both ports)
                                                                          │
                                                                          ▼
                                                                    RDS PostgreSQL
```

Devices are configured (via `AT@SIS`) to point at the **NLB's DNS name**
and port `6001` - the protocol's `Main Server IP / Domain Name` field
accepts a hostname, so you don't need a static IP.

Everything below is a **one-time setup**. Once it's done, `git push` to
`main`/`develop` and `.github/workflows/deploy.yml` handles the rest.

## 0. Prerequisites

- AWS CLI v2, configured (`aws configure`) with an account that can create
  the resources below.
- Decide `AWS_REGION` (examples below use `us-east-1`) and note your
  `AWS_ACCOUNT_ID` (`aws sts get-caller-identity --query Account --output text`).

Export these once so the commands below can just be copy-pasted:

```bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

## 1. Networking (VPC, subnets, security groups)

This uses 2 **public** subnets across 2 AZs for everything (ALB, NLB, and
the Fargate tasks with `assignPublicIp=ENABLED`). That avoids paying for a
NAT Gateway; the tasks are still not directly reachable except through the
two load balancers and RDS, because their security group only allows
inbound from those. Move to private subnets + NAT Gateway later if you
want tasks to have no public IP at all.

```bash
VPC_ID=$(aws ec2 create-vpc --cidr-block 10.20.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=avt-tracker-vpc}]' \
  --query 'Vpc.VpcId' --output text)
aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames

IGW_ID=$(aws ec2 create-internet-gateway --query 'InternetGateway.InternetGatewayId' --output text)
aws ec2 attach-internet-gateway --vpc-id $VPC_ID --internet-gateway-id $IGW_ID

SUBNET_A=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.20.1.0/24 \
  --availability-zone ${AWS_REGION}a --query 'Subnet.SubnetId' --output text)
SUBNET_B=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.20.2.0/24 \
  --availability-zone ${AWS_REGION}b --query 'Subnet.SubnetId' --output text)
aws ec2 modify-subnet-attribute --subnet-id $SUBNET_A --map-public-ip-on-launch
aws ec2 modify-subnet-attribute --subnet-id $SUBNET_B --map-public-ip-on-launch

RTB_ID=$(aws ec2 create-route-table --vpc-id $VPC_ID --query 'RouteTable.RouteTableId' --output text)
aws ec2 create-route --route-table-id $RTB_ID --destination-cidr-block 0.0.0.0/0 --gateway-id $IGW_ID
aws ec2 associate-route-table --route-table-id $RTB_ID --subnet-id $SUBNET_A
aws ec2 associate-route-table --route-table-id $RTB_ID --subnet-id $SUBNET_B

echo "SUBNET_A=$SUBNET_A  SUBNET_B=$SUBNET_B  VPC_ID=$VPC_ID"
```

Security groups - one for each load balancer, one for the ECS tasks, one for RDS:

```bash
ALB_SG=$(aws ec2 create-security-group --group-name avt-tracker-alb-sg \
  --description "ALB - HTTP API" --vpc-id $VPC_ID --query 'GroupId' --output text)
aws ec2 authorize-security-group-ingress --group-id $ALB_SG --protocol tcp --port 80 --cidr 0.0.0.0/0
# add 443 too once you attach an ACM certificate

TASK_SG=$(aws ec2 create-security-group --group-name avt-tracker-task-sg \
  --description "ECS tasks" --vpc-id $VPC_ID --query 'GroupId' --output text)
# HTTP API: only reachable through the ALB
aws ec2 authorize-security-group-ingress --group-id $TASK_SG --protocol tcp --port 3000 \
  --source-group $ALB_SG
# Tracker TCP: devices connect directly (through the NLB, which passes
# the original client IP straight through), so this must allow the
# internet directly - the NLB itself has no security group to filter on.
aws ec2 authorize-security-group-ingress --group-id $TASK_SG --protocol tcp --port 6001 --cidr 0.0.0.0/0

RDS_SG=$(aws ec2 create-security-group --group-name avt-tracker-rds-sg \
  --description "RDS Postgres" --vpc-id $VPC_ID --query 'GroupId' --output text)
aws ec2 authorize-security-group-ingress --group-id $RDS_SG --protocol tcp --port 5432 \
  --source-group $TASK_SG

echo "ALB_SG=$ALB_SG  TASK_SG=$TASK_SG  RDS_SG=$RDS_SG"
```

## 2. RDS PostgreSQL

```bash
aws rds create-db-subnet-group \
  --db-subnet-group-name avt-tracker-db-subnets \
  --db-subnet-group-description "avt-tracker" \
  --subnet-ids $SUBNET_A $SUBNET_B

DB_PASSWORD=$(openssl rand -base64 24)

aws rds create-db-instance \
  --db-instance-identifier avt-tracker-db \
  --db-name avt_tracker \
  --engine postgres --engine-version 16 \
  --db-instance-class db.t4g.micro \
  --allocated-storage 20 \
  --master-username avt \
  --master-user-password "$DB_PASSWORD" \
  --vpc-security-group-ids $RDS_SG \
  --db-subnet-group-name avt-tracker-db-subnets \
  --no-publicly-accessible \
  --backup-retention-period 7

aws rds wait db-instance-available --db-instance-identifier avt-tracker-db
RDS_ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier avt-tracker-db \
  --query 'DBInstances[0].Endpoint.Address' --output text)
echo "RDS_ENDPOINT=$RDS_ENDPOINT"
```

Save `$DB_PASSWORD` somewhere safe (a password manager) - it's about to go
into Secrets Manager and then you don't need to keep it lying around in
shell history.

## 3. Secrets Manager

```bash
aws secretsmanager create-secret \
  --name avt-tracker/db-credentials \
  --secret-string "{\"username\":\"avt\",\"password\":\"$DB_PASSWORD\"}"
```

## 4. ECR repository

```bash
aws ecr create-repository --repository-name avt-tracker \
  --image-scanning-configuration scanOnPush=true
```

## 5. IAM roles

**Execution role** (lets ECS pull the image, write logs, and read the
Secrets Manager secret referenced in the task definition):

```bash
aws iam create-role --role-name avt-tracker-execution-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{ "Effect": "Allow", "Principal": { "Service": "ecs-tasks.amazonaws.com" }, "Action": "sts:AssumeRole" }]
  }'

aws iam attach-role-policy --role-name avt-tracker-execution-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

aws iam put-role-policy --role-name avt-tracker-execution-role \
  --policy-name avt-tracker-secrets-access \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": \"secretsmanager:GetSecretValue\",
      \"Resource\": \"arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:avt-tracker/db-credentials*\"
    }]
  }"
```

**Task role** (permissions the *app itself* needs at runtime - empty for
now, this project doesn't call any other AWS API yet; attach policies here
later if that changes):

```bash
aws iam create-role --role-name avt-tracker-task-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{ "Effect": "Allow", "Principal": { "Service": "ecs-tasks.amazonaws.com" }, "Action": "sts:AssumeRole" }]
  }'
```

## 6. ECS cluster

```bash
aws ecs create-cluster --cluster-name avt-tracker-cluster
# repeat for qa if you want a fully separate environment:
aws ecs create-cluster --cluster-name avt-tracker-cluster-qa
```

## 7. Load balancers + target groups

**ALB (HTTP API):**

```bash
ALB_ARN=$(aws elbv2 create-load-balancer --name avt-tracker-alb \
  --subnets $SUBNET_A $SUBNET_B --security-groups $ALB_SG --type application \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)

HTTP_TG_ARN=$(aws elbv2 create-target-group --name avt-tracker-http-tg \
  --protocol HTTP --port 3000 --vpc-id $VPC_ID --target-type ip \
  --health-check-path / --health-check-protocol HTTP \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

aws elbv2 create-listener --load-balancer-arn $ALB_ARN \
  --protocol HTTP --port 80 \
  --default-actions Type=forward,TargetGroupArn=$HTTP_TG_ARN
```

**NLB (tracker TCP):**

```bash
NLB_ARN=$(aws elbv2 create-load-balancer --name avt-tracker-nlb \
  --subnets $SUBNET_A $SUBNET_B --type network \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)

TCP_TG_ARN=$(aws elbv2 create-target-group --name avt-tracker-tcp-tg \
  --protocol TCP --port 6001 --vpc-id $VPC_ID --target-type ip \
  --health-check-protocol TCP \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

aws elbv2 create-listener --load-balancer-arn $NLB_ARN \
  --protocol TCP --port 6001 \
  --default-actions Type=forward,TargetGroupArn=$TCP_TG_ARN

# This is the hostname devices get configured with (AT@SIS accepts a
# domain name, not just an IP, so there's no need for an Elastic IP):
aws elbv2 describe-load-balancers --load-balancer-arns $NLB_ARN \
  --query 'LoadBalancers[0].DNSName' --output text
```

## 8. CloudWatch log group

Skippable - the task definition sets `"awslogs-create-group": "true"`, so
ECS creates it on first run as long as the execution role has
`logs:CreateLogGroup` (included in `AmazonECSTaskExecutionRolePolicy`).

## 9. Fill in and register the task definition

Edit `.aws/task-definition.json` and replace the placeholders:

- `<AWS_ACCOUNT_ID>` (both role ARNs and the image repo)
- `<AWS_REGION>`
- `<RDS_ENDPOINT>` → the value printed in step 2

Or do it with `sed` (adjust as needed):

```bash
sed -i "s/<AWS_ACCOUNT_ID>/$AWS_ACCOUNT_ID/g; s/<AWS_REGION>/$AWS_REGION/g; s/<RDS_ENDPOINT>/$RDS_ENDPOINT/g" \
  .aws/task-definition.json
```

Then register it once so a service can reference it:

```bash
TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json file://.aws/task-definition.json \
  --query 'taskDefinition.taskDefinitionArn' --output text)
```

## 10. Create the ECS service (both load balancers, one task)

```bash
aws ecs create-service \
  --cluster avt-tracker-cluster \
  --service-name avt-tracker-service \
  --task-definition "$TASK_DEF_ARN" \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_A,$SUBNET_B],securityGroups=[$TASK_SG],assignPublicIp=ENABLED}" \
  --load-balancers \
      "targetGroupArn=$HTTP_TG_ARN,containerName=avt-tracker,containerPort=3000" \
      "targetGroupArn=$TCP_TG_ARN,containerName=avt-tracker,containerPort=6001"
```

Repeat steps 7-10 with an `-qa` suffix on every resource name if you want
a fully separate `develop`-branch environment (matching
`avt-tracker-cluster-qa` / `avt-tracker-service-qa` already referenced in
the workflow). If qa and prod should use **different** databases/secrets,
duplicate `.aws/task-definition.json` (e.g.
`task-definition.qa.json`) with its own `DB_HOST`/secret ARN, and branch
`ECS_TASK_DEFINITION` in the workflow the same way `ECS_SERVICE`/
`ECS_CLUSTER` already are.

## 11. Run the first migration + smoke-check manually

The GitHub Actions pipeline runs migrations automatically on every deploy
(see `.github/workflows/deploy.yml`), but for this very first deploy the
image referenced in the task definition is still the `:placeholder` tag,
so there's nothing to run yet. Once you've pushed to `main`/`develop` once
and the pipeline has built+pushed a real image and run migrations, check:

```bash
curl http://<ALB_DNS_NAME>/tracker/devices
```

## 12. GitHub configuration

In your repo's **Settings → Environments**, create `production` and `qa`
environments (matching the `environment:` block in the workflow), each
with these secrets:

| Secret | Value |
| --- | --- |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM user credentials with permission to push to ECR and manage the ECS resources above (or switch to OIDC role assumption - more secure, recommended once this is working) |
| `ECS_SUBNET_IDS` | `$SUBNET_A,$SUBNET_B` (comma-separated, no spaces) |
| `ECS_SECURITY_GROUP_ID` | `$TASK_SG` |

Then:

```bash
git push origin main     # deploys to production
git push origin develop  # deploys to qa
```

## 13. Point the devices at it

```
AT@SIS=at,0,1,<NLB_DNS_NAME>,6001,,,0,0001#
```

## Notes / next hardening steps

- **HTTPS**: request an ACM certificate for the ALB, add a 443 listener,
  redirect 80 → 443. The tracker TCP protocol has no TLS in this codebase
  yet - devices connect over plain TCP.
- **OIDC instead of long-lived AWS keys** in GitHub Actions
  (`aws-actions/configure-aws-credentials` supports `role-to-assume` +
  `permissions: id-token: write` instead of access keys) is the safer
  long-term setup.
- **Private subnets + NAT Gateway** for the tasks once you want them to
  have no public IP at all (costs ~$30+/month for the NAT Gateway).
- **Autoscaling**: `aws application-autoscaling register-scalable-target`
  against the ECS service if traffic grows.
