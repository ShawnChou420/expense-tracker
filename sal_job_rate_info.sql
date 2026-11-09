-- public.sal_job_rate_info definition

-- Drop table

-- DROP TABLE public.sal_job_rate_info;

CREATE TABLE public.sal_job_rate_info (
	job_rate_id uuid DEFAULT gen_random_uuid() NOT NULL,
	user_id uuid NOT NULL,
	job_name varchar(100) DEFAULT '預設工作'::character varying NOT NULL,
	base_rate numeric(10, 3) NOT NULL,
	casual_loading numeric(10, 3) NOT NULL,
	shift_loading numeric(10, 3) NOT NULL,
	sat_ord_loading numeric(10, 3) NOT NULL,
	time_half_rate numeric(10, 3) NOT NULL,
	double_rate numeric(10, 3) NOT NULL,
	sunday_loading numeric(10, 3) NOT NULL,
	ppe_allowance numeric(10, 2) NOT NULL,
	smoko_duration int4 NOT NULL,
	withholding_tax numeric(5, 4) NOT NULL,
	status_cd bpchar(1) DEFAULT 'A'::bpchar NOT NULL,
	cr_dt timestamptz DEFAULT now() NULL,
	CONSTRAINT sal_job_rate_info_pkey PRIMARY KEY (job_rate_id)
);