-- public.sal_shift_txn definition

-- Drop table

-- DROP TABLE public.sal_shift_txn;

CREATE TABLE public.sal_shift_txn (
	txn_id uuid DEFAULT gen_random_uuid() NOT NULL,
	job_rate_id uuid NOT NULL,
	work_date date NOT NULL,
	start_time varchar(5) NOT NULL,
	end_time varchar(5) NOT NULL,
	total_minutes int4 NOT NULL,
	smoko_count int4 NOT NULL,
	smoko_deduct_minutes int4 NOT NULL,
	paid_minutes int4 NOT NULL,
	weekday_paid_minutes int4 NOT NULL,
	saturday_paid_minutes int4 NOT NULL,
	sunday_paid_minutes int4 NOT NULL,
	holiday_paid_minutes int4 NOT NULL,
	sat_ord_minutes int4 NOT NULL,
	time_half_minutes int4 NOT NULL,
	double_minutes int4 NOT NULL,
	base_pay numeric(10, 2) NOT NULL,
	casual_pay numeric(10, 2) NOT NULL,
	shift_pay numeric(10, 2) NOT NULL,
	holiday_penalty_rate numeric(10, 3) NOT NULL,
	holiday_penalty_pay numeric(10, 2) NOT NULL,
	sat_ord_pay numeric(10, 2) NOT NULL,
	time_half_pay numeric(10, 2) NOT NULL,
	double_pay numeric(10, 2) NOT NULL,
	sun_ord_pay numeric(10, 2) NOT NULL,
	gross_pay numeric(10, 2) NOT NULL,
	cr_dt timestamptz DEFAULT now() NULL,
	CONSTRAINT sal_shift_txn_pkey PRIMARY KEY (txn_id)
);


-- public.sal_shift_txn foreign keys

ALTER TABLE public.sal_shift_txn ADD CONSTRAINT sal_shift_txn_job_rate_id_fkey FOREIGN KEY (job_rate_id) REFERENCES public.sal_job_rate_info(job_rate_id);