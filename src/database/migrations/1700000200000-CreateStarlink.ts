import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStarlink1700000200000 implements MigrationInterface {
  name = 'CreateStarlink1700000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "starlink_device" (
        "deviceId" varchar(20) NOT NULL,
        "alias" varchar(100),
        "lastSeenAt" timestamptz,
        "lastReportAt" timestamptz,
        "lastEventId" integer,
        "lastEventName" varchar(100),
        "lastLatitude" double precision,
        "lastLongitude" double precision,
        "lastSpeedKnots" double precision,
        "lastSpeedKmh" double precision,
        "lastIgnition" boolean,
        "lastBatteryVoltage" double precision,
        "lastMainPowerVoltage" double precision,
        "tcpConnected" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_starlink_device_deviceId" PRIMARY KEY ("deviceId")
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_starlink_device_lastSeenAt" ON "starlink_device" ("lastSeenAt");`,
    );

    await queryRunner.query(`
      CREATE TABLE "starlink_report" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "deviceId" varchar(20) NOT NULL,
        "messageType" integer NOT NULL,
        "messageIndex" integer NOT NULL,
        "eventId" integer,
        "eventName" varchar(100),
        "alarm" varchar(50),
        "deviceTime" timestamptz,
        "fixTime" timestamptz,
        "latitude" double precision,
        "longitude" double precision,
        "altitudeM" double precision,
        "speedKnots" double precision,
        "speedKmh" double precision,
        "course" integer,
        "odometerM" bigint,
        "lac" integer,
        "cid" integer,
        "mainPowerVoltage" double precision,
        "batteryVoltage" double precision,
        "ignition" boolean,
        "satellites" integer,
        "pdop" double precision,
        "digitalInputs" jsonb,
        "digitalOutputs" jsonb,
        "destination" varchar(50),
        "unsupportedTags" jsonb,
        "parseWarnings" jsonb,
        "payload" jsonb NOT NULL,
        "rawLine" text NOT NULL,
        "checksumHex" varchar(2),
        "receivedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_starlink_report_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_starlink_report_deviceId" FOREIGN KEY ("deviceId")
          REFERENCES "starlink_device" ("deviceId") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_starlink_report_deviceId" ON "starlink_report" ("deviceId");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_starlink_report_receivedAt" ON "starlink_report" ("receivedAt");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "starlink_report";`);
    await queryRunner.query(`DROP TABLE "starlink_device";`);
  }
}
