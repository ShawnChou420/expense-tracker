-- public.salary_setting_info definition

-- Drop table

-- DROP TABLE public.salary_setting_info;

CREATE TABLE public.salary_setting_info (
	seq bigserial NOT NULL,
	user_seq int8 NOT NULL,
	base_rate numeric(10, 4) DEFAULT 0 NULL,
	casual_loading_rate numeric(10, 4) DEFAULT 0 NULL,
	shift_loading_rate numeric(10, 4) DEFAULT 0 NULL,
	saturday_ord_loading_rate numeric(10, 4) DEFAULT 0 NULL,
	sunday_loading_rate numeric(10, 4) DEFAULT 0 NULL,
	time_half_rate numeric(10, 4) DEFAULT 0 NULL,
	double_rate numeric(10, 4) DEFAULT 0 NULL,
	ppe_allowance numeric(10, 4) DEFAULT 0 NULL,
	withholding_tax_rate numeric(10, 4) DEFAULT 0 NULL,
	create_time timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	update_time timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	update_user varchar(50) NULL,
	CONSTRAINT salary_setting_info_pkey PRIMARY KEY (seq)
);

-- Table Triggers

create trigger trg_salary_setting_info_upd before
update
    on
    public.salary_setting_info for each row execute function update_modified_column();


-- public.salary_setting_info foreign keys

ALTER TABLE public.salary_setting_info ADD CONSTRAINT fk_salary_setting_user FOREIGN KEY (user_seq) REFERENCES public.user_info(seq) ON DELETE CASCADE;