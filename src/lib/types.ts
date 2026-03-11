export interface Case {
  id: string;
  client_name: string;
  client_email: string | null;
  firm_name: string | null;
  matter_name: string;
  matter_description: string | null;
  status: 'intake' | 'processing' | 'complete' | 'error';
  case_type: 'legal_matter' | 'ma_due_diligence';
  gdrive_url: string | null;
  r2_prefix: string | null;
  doc_count: number;
  event_count: number;
  processing_log: string | null;
  client_pin: string | null;
  created_at: string;
  updated_at: string;
}

export interface Event {
  id: string;
  case_id: string;
  event_date: string | null;
  event_date_raw: string | null;
  title: string;
  description: string;
  source_doc: string;
  source_page: number | null;
  source_quote: string | null;
  parties: string | null;
  tags: string | null;
  sort_order: number;
  created_at: string;
}

export interface Settings {
  ai_model: string;
  extraction_prompt: string;
  synthesis_prompt: string;
}
