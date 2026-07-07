# Protocol reference

Place the vendor PDF here as `AVT110_Tracker_Protocol_6_01.pdf` (it was
provided as reference material during development but not as a binary file
in this repo, so it isn't checked in yet).

The parser implementation (`src/tracker/parser/`) follows that document's
"AVT110 Tracker Protocol R6.01" spec, in particular:

- Section 1 (Data Stream Format) - frame types and the `#` terminator.
- Section 3.1-3.2.1 (Message Format / +RPT / -RPT) - header/trailer layout
  and the `Data Mask` / `Event Type` tables.
- Section 3.3 (+HBD/+SHBD heartbeat).
- Section 3.4 (+ACK/+SACK acknowledgements).

See the "Known limitations / TODOs" section of the top-level README for
which parts of the Data Mask (CAN bus, tachograph, BLE, NMEA2000, ...)
aren't decoded yet - those are the sections of the PDF to consult first
when extending the parser.
