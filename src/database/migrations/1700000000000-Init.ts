import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1700000000000 implements MigrationInterface {
  name = 'Init1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tracker_device" (
        "imei" varchar(20) NOT NULL,
        "alias" varchar(100),
        "lastSeenAt" timestamptz,
        "lastReportAt" timestamptz,
        "lastFrameKind" varchar(8),
        "lastLatitude" double precision,
        "lastLongitude" double precision,
        "lastAltitudeM" integer,
        "lastSpeedKmh" integer,
        "lastEventType" integer,
        "lastEventName" varchar(100),
        "lastBatteryLevelPercent" integer,
        "lastBatteryVoltageMv" integer,
        "lastNetworkType" integer,
        "tcpConnected" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tracker_device_imei" PRIMARY KEY ("imei")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_tracker_device_lastSeenAt" ON "tracker_device" ("lastSeenAt");
    `);

    await queryRunner.query(`
      CREATE TABLE "tracker_report" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "imei" varchar(20) NOT NULL,
        "frameKind" varchar(8) NOT NULL,
        "protocolVersion" varchar(16),
        "eventType" integer,
        "eventName" varchar(100),
        "eventState" integer,
        "latitude" double precision,
        "longitude" double precision,
        "altitudeM" integer,
        "speedKmh" integer,
        "azimuth" integer,
        "satelliteCount" integer,
        "batteryVoltageMv" integer,
        "batteryLevelPercent" integer,
        "mainPowerVoltageMv" integer,
        "networkType" integer,
        "mcc" integer,
        "mnc" integer,
        "lac" integer,
        "cellId" bigint,
        "csq" integer,
        "dataMaskHex" varchar(16),
        "eventDataMaskHex" varchar(16),
        "unsupportedDataMaskBits" jsonb,
        "parseWarnings" jsonb,
        "payload" jsonb NOT NULL,
        "rawHex" text NOT NULL,
        "generatedAt" timestamptz,
        "receivedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tracker_report_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tracker_report_imei" FOREIGN KEY ("imei")
          REFERENCES "tracker_device" ("imei") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_tracker_report_imei" ON "tracker_report" ("imei");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tracker_report_generatedAt" ON "tracker_report" ("generatedAt");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tracker_report_receivedAt" ON "tracker_report" ("receivedAt");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tracker_report";`);
    await queryRunner.query(`DROP TABLE "tracker_device";`);
  }
}
