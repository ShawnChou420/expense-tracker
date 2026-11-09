-- Explicitly free fares may be settled with no monetary payment.
ALTER TABLE trip_charge ADD COLUMN status_code VARCHAR(20) NOT NULL DEFAULT 'PENDING';
ALTER TABLE trip_charge ADD CONSTRAINT ck_trip_charge_status
    CHECK (status_code IN ('PENDING', 'PARTIAL', 'PAID'));
