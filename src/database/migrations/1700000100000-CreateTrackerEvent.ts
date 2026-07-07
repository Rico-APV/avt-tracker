import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTrackerEvent1700000100000 implements MigrationInterface {
  name = 'CreateTrackerEvent1700000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tracker_event" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "eventType" varchar(64) NOT NULL,
        "imei" varchar(20) NOT NULL,
        "data" jsonb NOT NULL,
        "occurredAt" timestamptz NOT NULL,
        "delivered" boolean NOT NULL DEFAULT false,
        "deliveredAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tracker_event_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_tracker_event_imei" ON "tracker_event" ("imei");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tracker_event_delivered_occurredAt" ON "tracker_event" ("delivered", "occurredAt");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tracker_event";`);
  }
}
