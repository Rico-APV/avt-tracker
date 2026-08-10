import {
  deriveMobileyeAdasEvents,
  MobileyeAdasEventType,
  MobileyeAdasReading,
} from './mobileye-adas.types';

function reading(
  overrides: Partial<MobileyeAdasReading> = {},
): MobileyeAdasReading {
  return {
    headwayValid: false,
    headwayMeasurementSeconds: 0,
    pedestrianForwardCollisionWarning: false,
    pedestrianInDangerZone: false,
    laneDepartureWarningOff: false,
    forwardCollisionWarningOn: false,
    leftLaneDepartureWarningOn: false,
    rightLaneDepartureWarningOn: false,
    ...overrides,
  };
}

describe('deriveMobileyeAdasEvents', () => {
  it('returns no events for an all-clear reading', () => {
    expect(deriveMobileyeAdasEvents(reading())).toEqual([]);
  });

  it('maps each raw flag to its corresponding event type', () => {
    expect(
      deriveMobileyeAdasEvents(reading({ leftLaneDepartureWarningOn: true })),
    ).toEqual([MobileyeAdasEventType.LWDL]);

    expect(
      deriveMobileyeAdasEvents(reading({ rightLaneDepartureWarningOn: true })),
    ).toEqual([MobileyeAdasEventType.LWDR]);

    expect(
      deriveMobileyeAdasEvents(reading({ forwardCollisionWarningOn: true })),
    ).toEqual([MobileyeAdasEventType.FCW]);

    expect(
      deriveMobileyeAdasEvents(
        reading({ pedestrianForwardCollisionWarning: true }),
      ),
    ).toEqual([MobileyeAdasEventType.PCW]);

    expect(
      deriveMobileyeAdasEvents(reading({ pedestrianInDangerZone: true })),
    ).toEqual([MobileyeAdasEventType.PEDESTRIAN_IN_DANGER_ZONE]);
  });

  it('returns multiple events when several flags are set at once', () => {
    const events = deriveMobileyeAdasEvents(
      reading({
        leftLaneDepartureWarningOn: true,
        pedestrianInDangerZone: true,
      }),
    );

    expect(events).toEqual([
      MobileyeAdasEventType.LWDL,
      MobileyeAdasEventType.PEDESTRIAN_IN_DANGER_ZONE,
    ]);
  });

  it('does not raise an event just because LDW is switched off', () => {
    // <laneDepartureWarningOff> is a device configuration flag (AdvCAN PID
    // 5), not an alarm - it should never appear as an event by itself.
    expect(
      deriveMobileyeAdasEvents(reading({ laneDepartureWarningOff: true })),
    ).toEqual([]);
  });
});
