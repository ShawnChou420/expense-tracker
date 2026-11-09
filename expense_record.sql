-- public.expense_record definition

-- Drop table

-- DROP TABLE public.expense_record;

CREATE TABLE public.expense_record (
	seq int8 DEFAULT nextval('expense_record_dtl_seq_seq'::regclass) NOT NULL,
	user_seq int8 NOT NULL,
	expense_date date NOT NULL,
	category varchar(50) NOT NULL,
	amount numeric(12, 4) DEFAULT 0 NULL,
	remark text NULL,
	create_time timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	update_time timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	update_user varchar(50) NULL,
	CONSTRAINT expense_record_dtl_pkey PRIMARY KEY (seq)
);

-- Table Triggers

create trigger trg_expense_record_dtl_upd before
update
    on
    public.expense_record for each row execute function update_modified_column();


-- public.expense_record foreign keys

ALTER TABLE public.expense_record ADD CONSTRAINT fk_expense_record_user FOREIGN KEY (user_seq) REFERENCES public.user_info(seq) ON DELETE CASCADE;