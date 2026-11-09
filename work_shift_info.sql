-- public.work_shift_info definition

-- Drop table

-- DROP TABLE public.work_shift_info;

CREATE TABLE public.work_shift_info (
	seq int8 DEFAULT nextval('work_shift_dtl_seq_seq'::regclass) NOT NULL,
	user_seq int8 NOT NULL,
	work_date date NOT NULL,
	start_time time NOT NULL,
	end_time time NOT NULL,
	total_minutes int4 DEFAULT 0 NULL,
	smoko_count int4 DEFAULT 0 NULL,
	gross_pay numeric(12, 4) DEFAULT 0 NULL,
	create_time timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	update_time timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	update_user varchar(50) NULL,
	CONSTRAINT work_shift_dtl_pkey PRIMARY KEY (seq)
);

-- Table Triggers

create trigger trg_work_shift_dtl_upd before
update
    on
    public.work_shift_info for each row execute function update_modified_column();


-- public.work_shift_info foreign keys

ALTER TABLE public.work_shift_info ADD CONSTRAINT fk_work_shift_user FOREIGN KEY (user_seq) REFERENCES public.user_info(seq) ON DELETE CASCADE;