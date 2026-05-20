export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_conversations: {
        Row: {
          created_at: string
          id: string
          salon_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          salon_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          salon_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          input_tokens: number | null
          output_tokens: number | null
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          salon_id: string
          scopes: string[]
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          salon_id: string
          scopes?: string[]
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          salon_id?: string
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      app_admins: {
        Row: {
          granted_at: string
          granted_by: string | null
          is_super: boolean
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          is_super?: boolean
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          is_super?: boolean
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: unknown
          payload: Json | null
          salon_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: unknown
          payload?: Json | null
          salon_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: unknown
          payload?: Json | null
          salon_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          connection_id: string
          created_at: string
          currency: string | null
          external_id: string
          iban: string | null
          id: string
          is_active: boolean
          name: string | null
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          currency?: string | null
          external_id: string
          iban?: string | null
          id?: string
          is_active?: boolean
          name?: string | null
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          currency?: string | null
          external_id?: string
          iban?: string | null
          id?: string
          is_active?: boolean
          name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "bank_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_connections: {
        Row: {
          bank_aspsp_name: string | null
          bank_country: string | null
          bank_name: string | null
          created_at: string
          created_by: string | null
          expiry_email_sent_at: string | null
          history_days: number
          id: string
          last_error: string | null
          last_synced_at: string | null
          provider: string
          salon_id: string
          session_id: string | null
          status: string
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          bank_aspsp_name?: string | null
          bank_country?: string | null
          bank_name?: string | null
          created_at?: string
          created_by?: string | null
          expiry_email_sent_at?: string | null
          history_days?: number
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          provider?: string
          salon_id: string
          session_id?: string | null
          status?: string
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          bank_aspsp_name?: string | null
          bank_country?: string | null
          bank_name?: string | null
          created_at?: string
          created_by?: string | null
          expiry_email_sent_at?: string | null
          history_days?: number
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          provider?: string
          salon_id?: string
          session_id?: string | null
          status?: string
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_connections_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_sync_triggers: {
        Row: {
          connection_id: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          token: string
        }
        Insert: {
          connection_id: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          token?: string
        }
        Update: {
          connection_id?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_sync_triggers_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "bank_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          account_id: string
          amount_cents: number
          counterparty: string | null
          created_at: string
          currency: string
          description: string | null
          executed_at: string
          expense_id: string | null
          external_id: string
          id: string
          raw: Json | null
          type: string
        }
        Insert: {
          account_id: string
          amount_cents: number
          counterparty?: string | null
          created_at?: string
          currency: string
          description?: string | null
          executed_at: string
          expense_id?: string | null
          external_id: string
          id?: string
          raw?: Json | null
          type: string
        }
        Update: {
          account_id?: string
          amount_cents?: number
          counterparty?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          executed_at?: string
          expense_id?: string | null
          external_id?: string
          id?: string
          raw?: Json | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      banking_expiry_triggers: {
        Row: {
          created_at: string
          expires_at: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      benchmark_aggregates: {
        Row: {
          avg_check_cents: number | null
          computed_at: string
          country_code: string
          period: string
          rebooking_rate_pct: number | null
          revenue_per_master_cents: number | null
          salon_count: number
          salon_type: string
          top_services: Json | null
          visits_per_week: number | null
        }
        Insert: {
          avg_check_cents?: number | null
          computed_at?: string
          country_code: string
          period: string
          rebooking_rate_pct?: number | null
          revenue_per_master_cents?: number | null
          salon_count: number
          salon_type: string
          top_services?: Json | null
          visits_per_week?: number | null
        }
        Update: {
          avg_check_cents?: number | null
          computed_at?: string
          country_code?: string
          period?: string
          rebooking_rate_pct?: number | null
          revenue_per_master_cents?: number | null
          salon_count?: number
          salon_type?: string
          top_services?: Json | null
          visits_per_week?: number | null
        }
        Relationships: []
      }
      booksy_sync_triggers: {
        Row: {
          created_at: string
          expires_at: string
          salon_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          salon_id: string
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          salon_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booksy_sync_triggers_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      bug_digest_triggers: {
        Row: {
          created_at: string
          expires_at: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      bug_reports: {
        Row: {
          ai_categorized_at: string | null
          ai_steps_to_repro: string | null
          ai_summary: string | null
          approved_at: string | null
          approved_by: string | null
          area: string | null
          attachments: Json
          created_at: string
          duplicate_of: string | null
          fixed_at: string | null
          fixed_in_commit: string | null
          id: string
          kind: string
          message_text: string | null
          notes: string | null
          reported_at: string
          reporter_user_id: string | null
          requires_approval: boolean
          salon_id: string | null
          sender_first_name: string | null
          sender_id: number | null
          sender_username: string | null
          severity: Database["public"]["Enums"]["bug_severity"] | null
          source: string
          status: Database["public"]["Enums"]["bug_status"]
          telegram_chat_id: number | null
          telegram_message_id: number | null
          telegram_thread_id: number | null
          updated_at: string
        }
        Insert: {
          ai_categorized_at?: string | null
          ai_steps_to_repro?: string | null
          ai_summary?: string | null
          approved_at?: string | null
          approved_by?: string | null
          area?: string | null
          attachments?: Json
          created_at?: string
          duplicate_of?: string | null
          fixed_at?: string | null
          fixed_in_commit?: string | null
          id?: string
          kind?: string
          message_text?: string | null
          notes?: string | null
          reported_at?: string
          reporter_user_id?: string | null
          requires_approval?: boolean
          salon_id?: string | null
          sender_first_name?: string | null
          sender_id?: number | null
          sender_username?: string | null
          severity?: Database["public"]["Enums"]["bug_severity"] | null
          source?: string
          status?: Database["public"]["Enums"]["bug_status"]
          telegram_chat_id?: number | null
          telegram_message_id?: number | null
          telegram_thread_id?: number | null
          updated_at?: string
        }
        Update: {
          ai_categorized_at?: string | null
          ai_steps_to_repro?: string | null
          ai_summary?: string | null
          approved_at?: string | null
          approved_by?: string | null
          area?: string | null
          attachments?: Json
          created_at?: string
          duplicate_of?: string | null
          fixed_at?: string | null
          fixed_in_commit?: string | null
          id?: string
          kind?: string
          message_text?: string | null
          notes?: string | null
          reported_at?: string
          reporter_user_id?: string | null
          requires_approval?: boolean
          salon_id?: string | null
          sender_first_name?: string | null
          sender_id?: number | null
          sender_username?: string | null
          severity?: Database["public"]["Enums"]["bug_severity"] | null
          source?: string
          status?: Database["public"]["Enums"]["bug_status"]
          telegram_chat_id?: number | null
          telegram_message_id?: number | null
          telegram_thread_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bug_reports_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "bug_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_feed_tokens: {
        Row: {
          created_at: string
          id: string
          last_accessed_at: string | null
          revoked_at: string | null
          salon_id: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_accessed_at?: string | null
          revoked_at?: string | null
          salon_id: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_accessed_at?: string | null
          revoked_at?: string | null
          salon_id?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_feed_tokens_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_shifts: {
        Row: {
          actual_card_cents: number | null
          actual_cash_cents: number | null
          close_comment: string | null
          closed_at: string | null
          closed_by_user_id: string | null
          created_at: string
          diff_card_cents: number | null
          diff_cash_cents: number | null
          discrepancy_reason: string | null
          expected_card_cents: number | null
          expected_cash_cents: number | null
          id: string
          opened_at: string
          opened_by_user_id: string | null
          opening_amount_cents: number
          opening_comment: string | null
          salon_id: string
          status: string
        }
        Insert: {
          actual_card_cents?: number | null
          actual_cash_cents?: number | null
          close_comment?: string | null
          closed_at?: string | null
          closed_by_user_id?: string | null
          created_at?: string
          diff_card_cents?: number | null
          diff_cash_cents?: number | null
          discrepancy_reason?: string | null
          expected_card_cents?: number | null
          expected_cash_cents?: number | null
          id?: string
          opened_at?: string
          opened_by_user_id?: string | null
          opening_amount_cents?: number
          opening_comment?: string | null
          salon_id: string
          status?: string
        }
        Update: {
          actual_card_cents?: number | null
          actual_cash_cents?: number | null
          close_comment?: string | null
          closed_at?: string | null
          closed_by_user_id?: string | null
          created_at?: string
          diff_card_cents?: number | null
          diff_cash_cents?: number | null
          discrepancy_reason?: string | null
          expected_card_cents?: number | null
          expected_cash_cents?: number | null
          id?: string
          opened_at?: string
          opened_by_user_id?: string | null
          opening_amount_cents?: number
          opening_comment?: string | null
          salon_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_shifts_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_transfers: {
        Row: {
          amount_cents: number
          comment: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          from_register_id: string
          id: string
          reversal_of: string | null
          salon_id: string
          to_register_id: string
          transferred_at: string
        }
        Insert: {
          amount_cents: number
          comment?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          from_register_id: string
          id?: string
          reversal_of?: string | null
          salon_id: string
          to_register_id: string
          transferred_at?: string
        }
        Update: {
          amount_cents?: number
          comment?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          from_register_id?: string
          id?: string
          reversal_of?: string | null
          salon_id?: string
          to_register_id?: string
          transferred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_transfers_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "cash_transfers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_transfers_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          birthday: string | null
          created_at: string
          deleted_at: string | null
          discount_percent: number | null
          email: string | null
          external_id: string | null
          external_snapshot: Json | null
          external_source: string | null
          id: string
          last_visit_at: string | null
          name: string
          notes: string | null
          phone: string | null
          salon_id: string
          socials: Json
          source: string | null
          tags: string[]
          total_revenue_cents: number
          updated_at: string
          visit_count: number
        }
        Insert: {
          birthday?: string | null
          created_at?: string
          deleted_at?: string | null
          discount_percent?: number | null
          email?: string | null
          external_id?: string | null
          external_snapshot?: Json | null
          external_source?: string | null
          id?: string
          last_visit_at?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          salon_id: string
          socials?: Json
          source?: string | null
          tags?: string[]
          total_revenue_cents?: number
          updated_at?: string
          visit_count?: number
        }
        Update: {
          birthday?: string | null
          created_at?: string
          deleted_at?: string | null
          discount_percent?: number | null
          email?: string | null
          external_id?: string | null
          external_snapshot?: Json | null
          external_source?: string | null
          id?: string
          last_visit_at?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          salon_id?: string
          socials?: Json
          source?: string | null
          tags?: string[]
          total_revenue_cents?: number
          updated_at?: string
          visit_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "clients_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      counterparties: {
        Row: {
          address: string | null
          archived_at: string | null
          category_id: string | null
          created_at: string
          id: string
          name: string
          nip: string | null
          notes: string | null
          salon_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          name: string
          nip?: string | null
          notes?: string | null
          salon_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          name?: string
          nip?: string | null
          notes?: string | null
          salon_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "counterparties_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "counterparty_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counterparties_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      counterparty_categories: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          salon_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name: string
          salon_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name?: string
          salon_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "counterparty_categories_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      digest_triggers: {
        Row: {
          created_at: string
          expires_at: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          created_at: string
          id: string
          is_archived: boolean
          is_payroll: boolean
          is_system: boolean
          kind: string
          monthly_budget_cents: number | null
          monthly_budget_pct: number | null
          name: string
          salon_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          is_payroll?: boolean
          is_system?: boolean
          kind?: string
          monthly_budget_cents?: number | null
          monthly_budget_pct?: number | null
          name: string
          salon_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          is_payroll?: boolean
          is_system?: boolean
          kind?: string
          monthly_budget_cents?: number | null
          monthly_budget_pct?: number | null
          name?: string
          salon_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount_cents: number
          bank_transaction_id: string | null
          cash_register_id: string | null
          category_id: string | null
          comment: string | null
          contractor_name: string | null
          counterparty_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string
          document_number: string | null
          expense_at: string
          external_id: string | null
          id: string
          invoice_number: string | null
          is_recurring: boolean
          metadata: Json
          next_occurrence_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          payroll_kind: Database["public"]["Enums"]["payroll_kind"] | null
          payroll_period_end: string | null
          payroll_period_start: string | null
          payroll_staff_id: string | null
          receipt_storage_path: string | null
          receipt_url: string | null
          recurrence: Database["public"]["Enums"]["expense_recurrence"]
          recurrence_parent_id: string | null
          recurring_period: string | null
          salon_id: string
          source: string
          sub_article: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          bank_transaction_id?: string | null
          cash_register_id?: string | null
          category_id?: string | null
          comment?: string | null
          contractor_name?: string | null
          counterparty_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string
          document_number?: string | null
          expense_at: string
          external_id?: string | null
          id?: string
          invoice_number?: string | null
          is_recurring?: boolean
          metadata?: Json
          next_occurrence_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          payroll_kind?: Database["public"]["Enums"]["payroll_kind"] | null
          payroll_period_end?: string | null
          payroll_period_start?: string | null
          payroll_staff_id?: string | null
          receipt_storage_path?: string | null
          receipt_url?: string | null
          recurrence?: Database["public"]["Enums"]["expense_recurrence"]
          recurrence_parent_id?: string | null
          recurring_period?: string | null
          salon_id: string
          source?: string
          sub_article?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          bank_transaction_id?: string | null
          cash_register_id?: string | null
          category_id?: string | null
          comment?: string | null
          contractor_name?: string | null
          counterparty_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string
          document_number?: string | null
          expense_at?: string
          external_id?: string | null
          id?: string
          invoice_number?: string | null
          is_recurring?: boolean
          metadata?: Json
          next_occurrence_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          payroll_kind?: Database["public"]["Enums"]["payroll_kind"] | null
          payroll_period_end?: string | null
          payroll_period_start?: string | null
          payroll_staff_id?: string | null
          receipt_storage_path?: string | null
          receipt_url?: string | null
          recurrence?: Database["public"]["Enums"]["expense_recurrence"]
          recurrence_parent_id?: string | null
          recurring_period?: string | null
          salon_id?: string
          source?: string
          sub_article?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_payroll_staff_id_fkey"
            columns: ["payroll_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_recurrence_parent_id_fkey"
            columns: ["recurrence_parent_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      export_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          signed_url_expires_at: string | null
          status: string
          storage_path: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          signed_url_expires_at?: string | null
          status?: string
          storage_path?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          signed_url_expires_at?: string | null
          status?: string
          storage_path?: string | null
          user_id?: string
        }
        Relationships: []
      }
      fakturownia_sync_triggers: {
        Row: {
          created_at: string
          expires_at: string
          salon_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          salon_id: string
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          salon_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fakturownia_sync_triggers_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      infakt_sync_triggers: {
        Row: {
          created_at: string
          expires_at: string
          salon_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          salon_id: string
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          salon_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "infakt_sync_triggers_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_triggers: {
        Row: {
          created_at: string
          expires_at: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      insights: {
        Row: {
          area: string | null
          body: string | null
          created_at: string
          dismissed_at: string | null
          generated_at: string
          id: string
          is_dismissed: boolean
          kind: string
          payload: Json | null
          salon_id: string
          severity: Database["public"]["Enums"]["insight_severity"]
          title: string
        }
        Insert: {
          area?: string | null
          body?: string | null
          created_at?: string
          dismissed_at?: string | null
          generated_at?: string
          id?: string
          is_dismissed?: boolean
          kind: string
          payload?: Json | null
          salon_id: string
          severity?: Database["public"]["Enums"]["insight_severity"]
          title: string
        }
        Update: {
          area?: string | null
          body?: string | null
          created_at?: string
          dismissed_at?: string | null
          generated_at?: string
          id?: string
          is_dismissed?: boolean
          kind?: string
          payload?: Json | null
          salon_id?: string
          severity?: Database["public"]["Enums"]["insight_severity"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          category: string | null
          cost_per_unit_cents: number
          created_at: string
          current_stock: number
          id: string
          is_archived: boolean
          min_stock: number
          name: string
          notes: string | null
          salon_id: string
          sku: string | null
          supplier: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          cost_per_unit_cents?: number
          created_at?: string
          current_stock?: number
          id?: string
          is_archived?: boolean
          min_stock?: number
          name: string
          notes?: string | null
          salon_id: string
          sku?: string | null
          supplier?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          cost_per_unit_cents?: number
          created_at?: string
          current_stock?: number
          id?: string
          is_archived?: boolean
          min_stock?: number
          name?: string
          notes?: string | null
          salon_id?: string
          sku?: string | null
          supplier?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transactions: {
        Row: {
          cost_cents: number | null
          created_at: string
          created_by: string | null
          id: string
          material_id: string
          notes: string | null
          prev_stock: number | null
          quantity: number
          salon_id: string
          type: string
          visit_id: string | null
        }
        Insert: {
          cost_cents?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          material_id: string
          notes?: string | null
          prev_stock?: number | null
          quantity: number
          salon_id: string
          type: string
          visit_id?: string | null
        }
        Update: {
          cost_cents?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          material_id?: string
          notes?: string | null
          prev_stock?: number | null
          quantity?: number
          salon_id?: string
          type?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      ksef_sync_triggers: {
        Row: {
          created_at: string
          expires_at: string
          salon_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          salon_id: string
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          salon_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ksef_sync_triggers_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      media_posts: {
        Row: {
          author: string
          body_html: string | null
          body_md: string
          canonical_url: string | null
          cover_url: string | null
          created_at: string
          created_by: string | null
          description: string
          draft: boolean
          id: string
          keywords: string[] | null
          og_image_url: string | null
          published_at: string
          seo_description: string | null
          seo_title: string | null
          slug: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          author?: string
          body_html?: string | null
          body_md?: string
          canonical_url?: string | null
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          draft?: boolean
          id?: string
          keywords?: string[] | null
          og_image_url?: string | null
          published_at?: string
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          author?: string
          body_html?: string | null
          body_md?: string
          canonical_url?: string | null
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          draft?: boolean
          id?: string
          keywords?: string[] | null
          og_image_url?: string | null
          published_at?: string
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      messenger_conversations: {
        Row: {
          archived_at: string | null
          avatar_url: string | null
          channel: Database["public"]["Enums"]["messenger_channel"]
          client_id: string | null
          created_at: string
          display_name: string
          external_user_id: string
          id: string
          last_message_at: string
          last_message_preview: string | null
          salon_id: string
          unread_count: number
        }
        Insert: {
          archived_at?: string | null
          avatar_url?: string | null
          channel: Database["public"]["Enums"]["messenger_channel"]
          client_id?: string | null
          created_at?: string
          display_name?: string
          external_user_id: string
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          salon_id: string
          unread_count?: number
        }
        Update: {
          archived_at?: string | null
          avatar_url?: string | null
          channel?: Database["public"]["Enums"]["messenger_channel"]
          client_id?: string | null
          created_at?: string
          display_name?: string
          external_user_id?: string
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          salon_id?: string
          unread_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "messenger_conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messenger_conversations_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      messenger_integrations: {
        Row: {
          channel: Database["public"]["Enums"]["messenger_channel"]
          created_at: string
          credentials: Json | null
          display_name: string | null
          external_account_id: string | null
          id: string
          last_error: string | null
          last_synced_at: string | null
          salon_id: string
          status: string
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          channel: Database["public"]["Enums"]["messenger_channel"]
          created_at?: string
          credentials?: Json | null
          display_name?: string | null
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          salon_id: string
          status?: string
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["messenger_channel"]
          created_at?: string
          credentials?: Json | null
          display_name?: string | null
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          salon_id?: string
          status?: string
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messenger_integrations_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      messenger_messages: {
        Row: {
          conversation_id: string
          created_at: string
          direction: string
          external_message_id: string | null
          id: string
          media_kind: string | null
          media_path: string | null
          salon_id: string
          sent_by_user_id: string | null
          text: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          direction: string
          external_message_id?: string | null
          id?: string
          media_kind?: string | null
          media_path?: string | null
          salon_id: string
          sent_by_user_id?: string | null
          text?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          direction?: string
          external_message_id?: string | null
          id?: string
          media_kind?: string | null
          media_path?: string | null
          salon_id?: string
          sent_by_user_id?: string | null
          text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messenger_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "messenger_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messenger_messages_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      other_income_categories: {
        Row: {
          created_at: string
          id: string
          is_archived: boolean
          is_system: boolean
          name: string
          parent_id: string | null
          salon_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          is_system?: boolean
          name: string
          parent_id?: string | null
          salon_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          is_system?: boolean
          name?: string
          parent_id?: string | null
          salon_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "other_income_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "other_income_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "other_income_categories_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      other_incomes: {
        Row: {
          amount_cents: number
          cash_register_id: string | null
          category_id: string | null
          comment: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          income_at: string
          payer_name: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          receipt_url: string | null
          salon_id: string
          source: string
          sub_article: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          cash_register_id?: string | null
          category_id?: string | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          income_at: string
          payer_name?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          receipt_url?: string | null
          salon_id: string
          source?: string
          sub_article?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          cash_register_id?: string | null
          category_id?: string | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          income_at?: string
          payer_name?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          receipt_url?: string | null
          salon_id?: string
          source?: string
          sub_article?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "other_incomes_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "other_income_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "other_incomes_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          code: Database["public"]["Enums"]["payment_method"]
          created_at: string
          id: string
          is_archived: boolean
          is_system: boolean
          label: string
          salon_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: Database["public"]["Enums"]["payment_method"]
          created_at?: string
          id?: string
          is_archived?: boolean
          is_system?: boolean
          label: string
          salon_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: Database["public"]["Enums"]["payment_method"]
          created_at?: string
          id?: string
          is_archived?: boolean
          is_system?: boolean
          label?: string
          salon_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_lines: {
        Row: {
          amount_cents: number
          description: string
          id: string
          line_type: string
          payout_id: string
          visit_id: string | null
        }
        Insert: {
          amount_cents: number
          description: string
          id?: string
          line_type: string
          payout_id: string
          visit_id?: string | null
        }
        Update: {
          amount_cents?: number
          description?: string
          id?: string
          line_type?: string
          payout_id?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_lines_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_lines_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          cash_register_id: string | null
          comment: string | null
          created_at: string
          id: string
          net_payout_cents: number
          paid_at: string | null
          period_end: string
          period_start: string
          salon_id: string
          staff_id: string
          status: Database["public"]["Enums"]["payout_status"]
          total_advances_cents: number
          total_deductions_cents: number
          total_payout_cents: number
          total_revenue_cents: number
          updated_at: string
        }
        Insert: {
          cash_register_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          net_payout_cents?: number
          paid_at?: string | null
          period_end: string
          period_start: string
          salon_id: string
          staff_id: string
          status?: Database["public"]["Enums"]["payout_status"]
          total_advances_cents?: number
          total_deductions_cents?: number
          total_payout_cents?: number
          total_revenue_cents?: number
          updated_at?: string
        }
        Update: {
          cash_register_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          net_payout_cents?: number
          paid_at?: string | null
          period_end?: string
          period_start?: string
          salon_id?: string
          staff_id?: string
          status?: Database["public"]["Enums"]["payout_status"]
          total_advances_cents?: number
          total_deductions_cents?: number
          total_payout_cents?: number
          total_revenue_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          is_tester: boolean
          locale: string
          phone: string | null
          telegram_id: number | null
          telegram_username: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          is_tester?: boolean
          locale?: string
          phone?: string | null
          telegram_id?: number | null
          telegram_username?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          is_tester?: boolean
          locale?: string
          phone?: string | null
          telegram_id?: number | null
          telegram_username?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      referral_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      referral_uses: {
        Row: {
          activated_at: string | null
          code: string
          created_at: string
          id: string
          referred_user_id: string
          referrer_user_id: string
        }
        Insert: {
          activated_at?: string | null
          code: string
          created_at?: string
          id?: string
          referred_user_id: string
          referrer_user_id: string
        }
        Update: {
          activated_at?: string | null
          code?: string
          created_at?: string
          id?: string
          referred_user_id?: string
          referrer_user_id?: string
        }
        Relationships: []
      }
      salon_holidays: {
        Row: {
          country_code: string | null
          created_at: string
          date: string
          id: string
          is_recurring: boolean
          label: string
          salon_id: string
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          date: string
          id?: string
          is_recurring?: boolean
          label: string
          salon_id: string
        }
        Update: {
          country_code?: string | null
          created_at?: string
          date?: string
          id?: string
          is_recurring?: boolean
          label?: string
          salon_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_holidays_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_integrations: {
        Row: {
          config: Json
          connected_at: string
          consecutive_failures: number
          credentials: Json
          id: string
          last_catalog_sync_at: string | null
          last_clients_sync_at: string | null
          last_error: string | null
          last_failure_alert_at: string | null
          last_sync_at: string | null
          last_sync_stats: Json | null
          provider: string
          salon_id: string
          status: string
          sync_interval_minutes: number
          updated_at: string
        }
        Insert: {
          config?: Json
          connected_at?: string
          consecutive_failures?: number
          credentials?: Json
          id?: string
          last_catalog_sync_at?: string | null
          last_clients_sync_at?: string | null
          last_error?: string | null
          last_failure_alert_at?: string | null
          last_sync_at?: string | null
          last_sync_stats?: Json | null
          provider: string
          salon_id: string
          status?: string
          sync_interval_minutes?: number
          updated_at?: string
        }
        Update: {
          config?: Json
          connected_at?: string
          consecutive_failures?: number
          credentials?: Json
          id?: string
          last_catalog_sync_at?: string | null
          last_clients_sync_at?: string | null
          last_error?: string | null
          last_failure_alert_at?: string | null
          last_sync_at?: string | null
          last_sync_stats?: Json | null
          provider?: string
          salon_id?: string
          status?: string
          sync_interval_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_integrations_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          auto_create_staff: boolean
          cancelled_at: string | null
          email: string
          expires_at: string
          id: string
          invited_at: string
          invited_avatar_url: string | null
          invited_by: string
          invited_first_name: string | null
          invited_last_name: string | null
          invited_phone: string | null
          role: Database["public"]["Enums"]["salon_role"]
          salon_id: string
          staff_id: string | null
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          auto_create_staff?: boolean
          cancelled_at?: string | null
          email: string
          expires_at?: string
          id?: string
          invited_at?: string
          invited_avatar_url?: string | null
          invited_by: string
          invited_first_name?: string | null
          invited_last_name?: string | null
          invited_phone?: string | null
          role?: Database["public"]["Enums"]["salon_role"]
          salon_id: string
          staff_id?: string | null
          token: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          auto_create_staff?: boolean
          cancelled_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          invited_at?: string
          invited_avatar_url?: string | null
          invited_by?: string
          invited_first_name?: string | null
          invited_last_name?: string | null
          invited_phone?: string | null
          role?: Database["public"]["Enums"]["salon_role"]
          salon_id?: string
          staff_id?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_invitations_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_invitations_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_kb_articles: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          salon_id: string
          section: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          salon_id: string
          section: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          salon_id?: string
          section?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_kb_articles_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_members: {
        Row: {
          created_at: string
          id: string
          invited_at: string | null
          invited_email: string | null
          joined_at: string | null
          role: Database["public"]["Enums"]["salon_role"]
          salon_id: string
          staff_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_at?: string | null
          invited_email?: string | null
          joined_at?: string | null
          role?: Database["public"]["Enums"]["salon_role"]
          salon_id: string
          staff_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_at?: string | null
          invited_email?: string | null
          joined_at?: string | null
          role?: Database["public"]["Enums"]["salon_role"]
          salon_id?: string
          staff_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_salon_members_staff"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_members_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_subscriptions: {
        Row: {
          bonus_until: string | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string
          current_period_start: string
          granted_by: string | null
          granted_reason: string | null
          id: string
          salon_id: string
          source: string
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          bonus_until?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end: string
          current_period_start: string
          granted_by?: string | null
          granted_reason?: string | null
          id?: string
          salon_id: string
          source?: string
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          bonus_until?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          granted_by?: string | null
          granted_reason?: string | null
          id?: string
          salon_id?: string
          source?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_subscriptions_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: true
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      salons: {
        Row: {
          accounting_settings: Json
          benchmarks_opt_in: boolean
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          cash_discipline_enabled: boolean
          churn_window_days: number
          country_code: string
          created_at: string
          created_by: string
          currency: string
          daily_digest_channels: string[]
          daily_digest_enabled: boolean
          deleted_at: string | null
          financial_settings: Json
          id: string
          inventory_archived_categories: string[]
          inventory_categories: string[]
          locale: string
          logo_url: string | null
          name: string
          opening_cash_balance_cents: number
          opening_hours: Json
          opening_hours_external_snapshot: Json | null
          retention_window_days: number
          salon_type: string
          timezone: string
          updated_at: string
          weekly_digest_channels: string[]
          weekly_digest_enabled: boolean
        }
        Insert: {
          accounting_settings?: Json
          benchmarks_opt_in?: boolean
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          cash_discipline_enabled?: boolean
          churn_window_days?: number
          country_code: string
          created_at?: string
          created_by: string
          currency?: string
          daily_digest_channels?: string[]
          daily_digest_enabled?: boolean
          deleted_at?: string | null
          financial_settings?: Json
          id?: string
          inventory_archived_categories?: string[]
          inventory_categories?: string[]
          locale?: string
          logo_url?: string | null
          name: string
          opening_cash_balance_cents?: number
          opening_hours?: Json
          opening_hours_external_snapshot?: Json | null
          retention_window_days?: number
          salon_type: string
          timezone?: string
          updated_at?: string
          weekly_digest_channels?: string[]
          weekly_digest_enabled?: boolean
        }
        Update: {
          accounting_settings?: Json
          benchmarks_opt_in?: boolean
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          cash_discipline_enabled?: boolean
          churn_window_days?: number
          country_code?: string
          created_at?: string
          created_by?: string
          currency?: string
          daily_digest_channels?: string[]
          daily_digest_enabled?: boolean
          deleted_at?: string | null
          financial_settings?: Json
          id?: string
          inventory_archived_categories?: string[]
          inventory_categories?: string[]
          locale?: string
          logo_url?: string | null
          name?: string
          opening_cash_balance_cents?: number
          opening_hours?: Json
          opening_hours_external_snapshot?: Json | null
          retention_window_days?: number
          salon_type?: string
          timezone?: string
          updated_at?: string
          weekly_digest_channels?: string[]
          weekly_digest_enabled?: boolean
        }
        Relationships: []
      }
      scheduled_payments: {
        Row: {
          amount_cents: number
          category_id: string | null
          comment: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          due_date: string
          external_id: string | null
          id: string
          invoice_number: string | null
          paid_at: string | null
          paid_expense_id: string | null
          salon_id: string
          source: string
          status: Database["public"]["Enums"]["scheduled_payment_status"]
          updated_at: string
          vendor_name: string | null
        }
        Insert: {
          amount_cents: number
          category_id?: string | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          due_date: string
          external_id?: string | null
          id?: string
          invoice_number?: string | null
          paid_at?: string | null
          paid_expense_id?: string | null
          salon_id: string
          source?: string
          status?: Database["public"]["Enums"]["scheduled_payment_status"]
          updated_at?: string
          vendor_name?: string | null
        }
        Update: {
          amount_cents?: number
          category_id?: string | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          due_date?: string
          external_id?: string | null
          id?: string
          invoice_number?: string | null
          paid_at?: string | null
          paid_expense_id?: string | null
          salon_id?: string
          source?: string
          status?: Database["public"]["Enums"]["scheduled_payment_status"]
          updated_at?: string
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_payments_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_payments_paid_expense_id_fkey"
            columns: ["paid_expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_payments_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      service_categories: {
        Row: {
          created_at: string
          id: string
          is_archived: boolean
          name: string
          salon_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          name: string
          salon_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          name?: string
          salon_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      service_materials: {
        Row: {
          created_at: string
          id: string
          material_id: string
          notes: string | null
          quantity: number
          service_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          material_id: string
          notes?: string | null
          quantity: number
          service_id: string
        }
        Update: {
          created_at?: string
          id?: string
          material_id?: string
          notes?: string | null
          quantity?: number
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_materials_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_materials_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          avg_check_cents: number
          avg_service_hours: number
          category_id: string | null
          cost_cents: number | null
          created_at: string
          default_duration_min: number | null
          default_price_cents: number
          external_id: string | null
          external_snapshot: Json | null
          external_source: string | null
          id: string
          is_archived: boolean
          materials_pct: number
          name: string
          salon_id: string
          staff_count_required: number
          staff_payout_pct: number
          staff_work_days_per_month: number
          staff_work_hours_per_day: number
          updated_at: string
          utilization_pct: number
        }
        Insert: {
          avg_check_cents?: number
          avg_service_hours?: number
          category_id?: string | null
          cost_cents?: number | null
          created_at?: string
          default_duration_min?: number | null
          default_price_cents?: number
          external_id?: string | null
          external_snapshot?: Json | null
          external_source?: string | null
          id?: string
          is_archived?: boolean
          materials_pct?: number
          name: string
          salon_id: string
          staff_count_required?: number
          staff_payout_pct?: number
          staff_work_days_per_month?: number
          staff_work_hours_per_day?: number
          updated_at?: string
          utilization_pct?: number
        }
        Update: {
          avg_check_cents?: number
          avg_service_hours?: number
          category_id?: string | null
          cost_cents?: number | null
          created_at?: string
          default_duration_min?: number | null
          default_price_cents?: number
          external_id?: string | null
          external_snapshot?: Json | null
          external_source?: string | null
          id?: string
          is_archived?: boolean
          materials_pct?: number
          name?: string
          salon_id?: string
          staff_count_required?: number
          staff_payout_pct?: number
          staff_work_days_per_month?: number
          staff_work_hours_per_day?: number
          updated_at?: string
          utilization_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "services_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          avatar_url: string | null
          chair_rent_cents: number | null
          created_at: string
          deleted_at: string | null
          display_color: string | null
          email: string | null
          external_id: string | null
          external_snapshot: Json | null
          external_source: string | null
          full_name: string
          id: string
          invite_sent_at: string | null
          invite_token: string | null
          is_active: boolean
          payout_fixed_cents: number | null
          payout_percent: number | null
          payout_scheme: Database["public"]["Enums"]["staff_payout_scheme"]
          retail_payout_enabled: boolean
          retail_payout_percent: number | null
          retention_window_days: number | null
          salon_id: string
          updated_at: string
          visible_on_calendar: boolean
          weekly_schedule: Json
        }
        Insert: {
          avatar_url?: string | null
          chair_rent_cents?: number | null
          created_at?: string
          deleted_at?: string | null
          display_color?: string | null
          email?: string | null
          external_id?: string | null
          external_snapshot?: Json | null
          external_source?: string | null
          full_name: string
          id?: string
          invite_sent_at?: string | null
          invite_token?: string | null
          is_active?: boolean
          payout_fixed_cents?: number | null
          payout_percent?: number | null
          payout_scheme?: Database["public"]["Enums"]["staff_payout_scheme"]
          retail_payout_enabled?: boolean
          retail_payout_percent?: number | null
          retention_window_days?: number | null
          salon_id: string
          updated_at?: string
          visible_on_calendar?: boolean
          weekly_schedule?: Json
        }
        Update: {
          avatar_url?: string | null
          chair_rent_cents?: number | null
          created_at?: string
          deleted_at?: string | null
          display_color?: string | null
          email?: string | null
          external_id?: string | null
          external_snapshot?: Json | null
          external_source?: string | null
          full_name?: string
          id?: string
          invite_sent_at?: string | null
          invite_token?: string | null
          is_active?: boolean
          payout_fixed_cents?: number | null
          payout_percent?: number | null
          payout_scheme?: Database["public"]["Enums"]["staff_payout_scheme"]
          retail_payout_enabled?: boolean
          retail_payout_percent?: number | null
          retention_window_days?: number | null
          salon_id?: string
          updated_at?: string
          visible_on_calendar?: boolean
          weekly_schedule?: Json
        }
        Relationships: [
          {
            foreignKeyName: "staff_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_service_overrides: {
        Row: {
          id: string
          payout_percent: number | null
          service_id: string
          staff_id: string
        }
        Insert: {
          id?: string
          payout_percent?: number | null
          service_id: string
          staff_id: string
        }
        Update: {
          id?: string
          payout_percent?: number | null
          service_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_service_overrides_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_service_overrides_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_time_blocks: {
        Row: {
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          kind: Database["public"]["Enums"]["staff_block_kind"]
          label: string | null
          salon_id: string
          staff_id: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          kind: Database["public"]["Enums"]["staff_block_kind"]
          label?: string | null
          salon_id: string
          staff_id: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["staff_block_kind"]
          label?: string | null
          salon_id?: string
          staff_id?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_time_blocks_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_time_blocks_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          payload: Json | null
          received_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          payload?: Json | null
          received_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          payload?: Json | null
          received_at?: string
        }
        Relationships: []
      }
      telegram_link_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tg_auth_flows: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          last_error: string | null
          pending_session_encrypted: string | null
          phone: string
          phone_code_hash_encrypted: string | null
          salon_id: string
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          last_error?: string | null
          pending_session_encrypted?: string | null
          phone: string
          phone_code_hash_encrypted?: string | null
          salon_id: string
          state?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          last_error?: string | null
          pending_session_encrypted?: string | null
          phone?: string
          phone_code_hash_encrypted?: string | null
          salon_id?: string
          state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tg_auth_flows_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      tg_dialog_views: {
        Row: {
          dialog_id: string
          last_closed_at: string | null
          last_opened_at: string
          session_id: string
        }
        Insert: {
          dialog_id: string
          last_closed_at?: string | null
          last_opened_at?: string
          session_id: string
        }
        Update: {
          dialog_id?: string
          last_closed_at?: string | null
          last_opened_at?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tg_dialog_views_dialog_id_fkey"
            columns: ["dialog_id"]
            isOneToOne: false
            referencedRelation: "tg_dialogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tg_dialog_views_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "tg_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      tg_dialogs: {
        Row: {
          archived: boolean
          created_at: string
          id: string
          last_message_at: string | null
          last_message_from_id: number | null
          last_message_text: string | null
          muted: boolean
          photo_path: string | null
          pinned: boolean
          session_id: string
          tg_chat_id: number
          title: string | null
          type: string
          unread_count: number
          updated_at: string
          username: string | null
        }
        Insert: {
          archived?: boolean
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_from_id?: number | null
          last_message_text?: string | null
          muted?: boolean
          photo_path?: string | null
          pinned?: boolean
          session_id: string
          tg_chat_id: number
          title?: string | null
          type: string
          unread_count?: number
          updated_at?: string
          username?: string | null
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_from_id?: number | null
          last_message_text?: string | null
          muted?: boolean
          photo_path?: string | null
          pinned?: boolean
          session_id?: string
          tg_chat_id?: number
          title?: string | null
          type?: string
          unread_count?: number
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tg_dialogs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "tg_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      tg_messages: {
        Row: {
          created_at: string
          deleted: boolean
          delivered: boolean
          dialog_id: string
          edited_at: string | null
          forward_from: Json | null
          from_tg_user_id: number | null
          id: string
          is_outgoing: boolean
          media_caption: string | null
          media_kind: string | null
          media_mime_type: string | null
          media_path: string | null
          media_pending: boolean
          media_size_bytes: number | null
          media_thumb_path: string | null
          reactions: Json | null
          read_by_recipient_at: string | null
          reply_to_tg_message_id: number | null
          sent_at: string
          session_id: string
          text: string | null
          tg_message_id: number
        }
        Insert: {
          created_at?: string
          deleted?: boolean
          delivered?: boolean
          dialog_id: string
          edited_at?: string | null
          forward_from?: Json | null
          from_tg_user_id?: number | null
          id?: string
          is_outgoing: boolean
          media_caption?: string | null
          media_kind?: string | null
          media_mime_type?: string | null
          media_path?: string | null
          media_pending?: boolean
          media_size_bytes?: number | null
          media_thumb_path?: string | null
          reactions?: Json | null
          read_by_recipient_at?: string | null
          reply_to_tg_message_id?: number | null
          sent_at: string
          session_id: string
          text?: string | null
          tg_message_id: number
        }
        Update: {
          created_at?: string
          deleted?: boolean
          delivered?: boolean
          dialog_id?: string
          edited_at?: string | null
          forward_from?: Json | null
          from_tg_user_id?: number | null
          id?: string
          is_outgoing?: boolean
          media_caption?: string | null
          media_kind?: string | null
          media_mime_type?: string | null
          media_path?: string | null
          media_pending?: boolean
          media_size_bytes?: number | null
          media_thumb_path?: string | null
          reactions?: Json | null
          read_by_recipient_at?: string | null
          reply_to_tg_message_id?: number | null
          sent_at?: string
          session_id?: string
          text?: string | null
          tg_message_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "tg_messages_dialog_id_fkey"
            columns: ["dialog_id"]
            isOneToOne: false
            referencedRelation: "tg_dialogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tg_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "tg_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      tg_outbox: {
        Row: {
          action: string
          attempts: number
          created_at: string
          dialog_id: string | null
          id: string
          last_error: string | null
          payload: Json
          processed_at: string | null
          session_id: string
          status: string
        }
        Insert: {
          action: string
          attempts?: number
          created_at?: string
          dialog_id?: string | null
          id?: string
          last_error?: string | null
          payload: Json
          processed_at?: string | null
          session_id: string
          status?: string
        }
        Update: {
          action?: string
          attempts?: number
          created_at?: string
          dialog_id?: string | null
          id?: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          session_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "tg_outbox_dialog_id_fkey"
            columns: ["dialog_id"]
            isOneToOne: false
            referencedRelation: "tg_dialogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tg_outbox_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "tg_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      tg_sessions: {
        Row: {
          bootstrap_completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          last_seen_at: string | null
          phone: string
          salon_id: string
          session_encrypted: string
          status: string
          tg_first_name: string | null
          tg_last_name: string | null
          tg_photo_path: string | null
          tg_user_id: number | null
          tg_username: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bootstrap_completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_seen_at?: string | null
          phone: string
          salon_id: string
          session_encrypted: string
          status?: string
          tg_first_name?: string | null
          tg_last_name?: string | null
          tg_photo_path?: string | null
          tg_user_id?: number | null
          tg_username?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bootstrap_completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_seen_at?: string | null
          phone?: string
          salon_id?: string
          session_encrypted?: string
          status?: string
          tg_first_name?: string | null
          tg_last_name?: string | null
          tg_photo_path?: string | null
          tg_user_id?: number | null
          tg_username?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tg_sessions_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_templates: {
        Row: {
          amount_cents: number | null
          client_id: string
          created_at: string
          id: string
          next_due_at: string
          paused_at: string | null
          recurrence_days: number
          salon_id: string
          service_id: string | null
          staff_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents?: number | null
          client_id: string
          created_at?: string
          id?: string
          next_due_at: string
          paused_at?: string | null
          recurrence_days: number
          salon_id: string
          service_id?: string | null
          staff_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number | null
          client_id?: string
          created_at?: string
          id?: string
          next_due_at?: string
          paused_at?: string | null
          recurrence_days?: number
          salon_id?: string
          service_id?: string | null
          staff_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_templates_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_templates_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_templates_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          amount_cents: number
          cash_register_id: string | null
          client_id: string | null
          comment: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          discount_cents: number
          duration_min: number | null
          external_id: string | null
          external_reservation_id: string | null
          group_key: string | null
          id: string
          inventory_item_id: string | null
          kind: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          salon_id: string
          service_id: string | null
          service_name_snapshot: string | null
          source: string
          staff_id: string | null
          status: Database["public"]["Enums"]["visit_status"]
          tip_cents: number
          updated_at: string
          visit_at: string
        }
        Insert: {
          amount_cents: number
          cash_register_id?: string | null
          client_id?: string | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          discount_cents?: number
          duration_min?: number | null
          external_id?: string | null
          external_reservation_id?: string | null
          group_key?: string | null
          id?: string
          inventory_item_id?: string | null
          kind?: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          salon_id: string
          service_id?: string | null
          service_name_snapshot?: string | null
          source?: string
          staff_id?: string | null
          status?: Database["public"]["Enums"]["visit_status"]
          tip_cents?: number
          updated_at?: string
          visit_at: string
        }
        Update: {
          amount_cents?: number
          cash_register_id?: string | null
          client_id?: string | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          discount_cents?: number
          duration_min?: number | null
          external_id?: string | null
          external_reservation_id?: string | null
          group_key?: string | null
          id?: string
          inventory_item_id?: string | null
          kind?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          salon_id?: string
          service_id?: string | null
          service_name_snapshot?: string | null
          source?: string
          staff_id?: string | null
          status?: Database["public"]["Enums"]["visit_status"]
          tip_cents?: number
          updated_at?: string
          visit_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "visits_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      wfirma_sync_triggers: {
        Row: {
          created_at: string
          expires_at: string
          salon_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          salon_id: string
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          salon_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wfirma_sync_triggers_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      salon_integrations_public: {
        Row: {
          config: Json | null
          connected_at: string | null
          id: string | null
          last_catalog_sync_at: string | null
          last_clients_sync_at: string | null
          last_error: string | null
          last_sync_at: string | null
          last_sync_stats: Json | null
          provider: string | null
          salon_id: string | null
          status: string | null
          sync_interval_minutes: number | null
          updated_at: string | null
        }
        Insert: {
          config?: Json | null
          connected_at?: string | null
          id?: string | null
          last_catalog_sync_at?: string | null
          last_clients_sync_at?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          last_sync_stats?: Json | null
          provider?: string | null
          salon_id?: string | null
          status?: string | null
          sync_interval_minutes?: number | null
          updated_at?: string | null
        }
        Update: {
          config?: Json | null
          connected_at?: string | null
          id?: string | null
          last_catalog_sync_at?: string | null
          last_clients_sync_at?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          last_sync_stats?: Json | null
          provider?: string | null
          salon_id?: string | null
          status?: string | null
          sync_interval_minutes?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salon_integrations_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_salon_invitation: { Args: { p_token: string }; Returns: Json }
      ai_salon_snapshot: { Args: { p_salon_id: string }; Returns: Json }
      analytics_revenue_by_payment: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_salon_id: string
        }
        Returns: {
          payment_method: Database["public"]["Enums"]["payment_method"]
          revenue_cents: number
          visits_count: number
        }[]
      }
      analytics_visits_heatmap: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_salon_id: string
          p_timezone?: string
        }
        Returns: {
          dow: number
          hour_of_day: number
          revenue_cents: number
          visits_count: number
        }[]
      }
      apply_referral_code: { Args: { p_code: string }; Returns: Json }
      auto_close_stale_shifts: { Args: never; Returns: undefined }
      calculate_payouts_for_period: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_salon_id: string
        }
        Returns: {
          full_name: string
          payout_cents: number
          payout_scheme: Database["public"]["Enums"]["staff_payout_scheme"]
          revenue_cents: number
          staff_id: string
          visit_count: number
        }[]
      }
      cash_flow_daily: {
        Args: { p_from: string; p_salon_id: string; p_to: string }
        Returns: {
          day: string
          inflow_cents: number
          net_cents: number
          outflow_cents: number
        }[]
      }
      cash_transfer_create: {
        Args: {
          p_amount_cents: number
          p_comment?: string
          p_from: string
          p_salon_id: string
          p_to: string
          p_transferred_at?: string
        }
        Returns: {
          amount_cents: number
          comment: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          from_register_id: string
          id: string
          reversal_of: string | null
          salon_id: string
          to_register_id: string
          transferred_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cash_transfer_reverse: {
        Args: { p_id: string }
        Returns: {
          amount_cents: number
          comment: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          from_register_id: string
          id: string
          reversal_of: string | null
          salon_id: string
          to_register_id: string
          transferred_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cash_transfer_soft_delete: {
        Args: { p_id: string; p_reason: string }
        Returns: {
          amount_cents: number
          comment: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          from_register_id: string
          id: string
          reversal_of: string | null
          salon_id: string
          to_register_id: string
          transferred_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cash_transfer_update: {
        Args: {
          p_amount_cents: number
          p_comment: string
          p_from_register_id: string
          p_id: string
          p_to_register_id: string
          p_transferred_at: string
        }
        Returns: {
          amount_cents: number
          comment: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          from_register_id: string
          id: string
          reversal_of: string | null
          salon_id: string
          to_register_id: string
          transferred_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      category_budgets_progress: {
        Args: { p_salon_id: string }
        Returns: {
          category_id: string
          current_month_cents: number
          monthly_budget_cents: number
          name: string
          progress_pct: number
        }[]
      }
      close_payout_period: {
        Args: {
          p_cash_register_id?: string
          p_period_end: string
          p_period_start: string
          p_salon_id: string
        }
        Returns: {
          payouts_created: number
          total_expense_cents: number
        }[]
      }
      compute_all_register_balances: {
        Args: { p_at?: string; p_salon_id: string }
        Returns: {
          balance_cents: number
          register_id: string
        }[]
      }
      compute_benchmarks: { Args: never; Returns: number }
      compute_cash_balance: { Args: { p_salon_id: string }; Returns: number }
      compute_register_balance: {
        Args: { p_at?: string; p_register_id: string; p_salon_id: string }
        Returns: number
      }
      create_salon_with_setup: {
        Args: {
          p_country_code: string
          p_currency: string
          p_expense_categories?: string[]
          p_locale?: string
          p_name: string
          p_salon_type: string
          p_services?: Json
          p_staff?: Json
          p_timezone: string
        }
        Returns: string
      }
      create_telegram_link_code: { Args: never; Returns: string }
      cron_run_banking_expiry_notify: { Args: never; Returns: number }
      cron_run_banking_syncs: { Args: never; Returns: number }
      cron_run_booksy_syncs: { Args: never; Returns: number }
      cron_run_fakturownia_syncs: { Args: never; Returns: number }
      cron_run_infakt_syncs: { Args: never; Returns: number }
      cron_run_ksef_syncs: { Args: never; Returns: number }
      cron_run_wfirma_syncs: { Args: never; Returns: number }
      dashboard_kpis: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_salon_id: string
        }
        Returns: {
          expense_cents: number
          profit_cents: number
          revenue_cents: number
          visits_count: number
        }[]
      }
      get_benchmark_comparison: { Args: { p_salon_id: string }; Returns: Json }
      get_or_create_calendar_token: {
        Args: { p_salon_id: string }
        Returns: string
      }
      get_or_create_referral_code: { Args: never; Returns: string }
      insights_salon_data: { Args: { p_salon_id: string }; Returns: Json }
      inventory_apply_tx: {
        Args: {
          p_cost_cents?: number
          p_material_id: string
          p_notes?: string
          p_quantity: number
          p_type: string
        }
        Returns: number
      }
      inventory_consumption_by_staff: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_salon_id: string
        }
        Returns: {
          avg_per_visit: number
          cost_per_unit_cents: number
          expected_per_visit: number
          material_id: string
          material_name: string
          staff_full_name: string
          staff_id: string
          total_consumed: number
          total_cost_cents: number
          unit: string
          visit_count: number
        }[]
      }
      inventory_plan_vs_fact: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_salon_id: string
        }
        Returns: {
          actual: number
          cost_per_unit_cents: number
          material_id: string
          material_name: string
          planned: number
          unit: string
          variance: number
          variance_value_cents: number
        }[]
      }
      inventory_stocktake: {
        Args: {
          p_actual_stock: number
          p_material_id: string
          p_notes?: string
        }
        Returns: number
      }
      is_salon_admin: { Args: { p_salon_id: string }; Returns: boolean }
      is_salon_owner: { Args: { p_salon_id: string }; Returns: boolean }
      list_salon_audit: {
        Args: {
          p_action_prefix?: string
          p_from?: string
          p_limit?: number
          p_salon_id: string
          p_to?: string
        }
        Returns: {
          action: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          payload: Json
          user_email: string
          user_full_name: string
          user_id: string
        }[]
      }
      list_salon_team: {
        Args: { p_salon_id: string }
        Returns: {
          email: string
          full_name: string
          joined_at: string
          phone: string
          role: Database["public"]["Enums"]["salon_role"]
          user_id: string
        }[]
      }
      month_forecast: { Args: { p_salon_id: string }; Returns: Json }
      my_staff_id: { Args: { p_salon_id: string }; Returns: string }
      process_bug_daily_digest: { Args: never; Returns: number }
      process_recurring_expenses: {
        Args: never
        Returns: {
          created: number
          processed: number
        }[]
      }
      process_weekly_digests: { Args: never; Returns: number }
      process_weekly_insights: { Args: never; Returns: number }
      revenue_by_day: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_salon_id: string
          p_timezone?: string
        }
        Returns: {
          day: string
          revenue_cents: number
          visits_count: number
        }[]
      }
      revoke_calendar_token: { Args: { p_salon_id: string }; Returns: boolean }
      salon_role_of: {
        Args: { p_salon_id: string }
        Returns: Database["public"]["Enums"]["salon_role"]
      }
      seed_demo_data: { Args: { p_salon_id: string }; Returns: Json }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      staff_performance_advanced: {
        Args: { p_end_ts: string; p_salon_id: string; p_start_ts: string }
        Returns: {
          full_name: string
          hire_date: string
          is_active: boolean
          rebook_pct: number
          retail_revenue_cents: number
          returned_clients_count: number
          revenue_6m_cents: number
          scheduled_minutes: number
          staff_id: string
          total_revenue_cents: number
          unique_clients_count: number
          utilization_pct: number
          visits_count: number
          visits_revenue_cents: number
          worked_minutes: number
        }[]
      }
      top_clients_by_revenue: {
        Args: {
          p_end: string
          p_limit?: number
          p_salon_id: string
          p_start: string
        }
        Returns: {
          client_id: string
          email: string
          full_name: string
          last_visit_at: string
          phone: string
          revenue_cents: number
          visit_count: number
        }[]
      }
      top_services_by_revenue: {
        Args: {
          p_limit?: number
          p_period_end: string
          p_period_start: string
          p_salon_id: string
        }
        Returns: {
          cost_cents: number
          margin_cents: number
          margin_pct: number
          revenue_cents: number
          service_id: string
          service_name: string
          visits_count: number
        }[]
      }
      top_staff_by_revenue: {
        Args: {
          p_limit?: number
          p_period_end: string
          p_period_start: string
          p_salon_id: string
        }
        Returns: {
          full_name: string
          revenue_cents: number
          staff_id: string
        }[]
      }
      upcoming_visit_templates: {
        Args: { p_horizon_days?: number; p_salon_id: string }
        Returns: {
          client_id: string
          client_name: string
          days_until: number
          id: string
          next_due_at: string
          recurrence_days: number
          service_id: string
          service_name: string
          staff_id: string
          staff_name: string
        }[]
      }
      user_admin_salon_ids: { Args: never; Returns: string[] }
      weekly_digest_kpis: {
        Args: { p_salon_id: string }
        Returns: {
          expense_cents: number
          period_end: string
          period_start: string
          prev_revenue_cents: number
          profit_cents: number
          revenue_cents: number
          top_service_name: string
          top_service_revenue_cents: number
          top_staff_name: string
          top_staff_revenue_cents: number
          visits_count: number
        }[]
      }
    }
    Enums: {
      bug_severity: "low" | "medium" | "high" | "critical"
      bug_status: "open" | "in_progress" | "fixed" | "wontfix" | "duplicate"
      expense_recurrence: "none" | "weekly" | "monthly"
      insight_severity: "info" | "warning" | "critical"
      messenger_channel:
        | "telegram"
        | "whatsapp"
        | "instagram"
        | "facebook"
        | "internal"
      payment_method: "cash" | "card" | "transfer" | "online" | "mixed"
      payout_status: "draft" | "paid"
      payroll_kind: "advance" | "final"
      salon_role: "owner" | "admin" | "staff" | "accountant"
      scheduled_payment_status: "pending" | "paid"
      staff_block_kind: "reservation" | "absence"
      staff_payout_scheme:
        | "fixed"
        | "percent_revenue"
        | "percent_service"
        | "chair_rent"
        | "mixed"
      subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "incomplete"
        | "incomplete_expired"
        | "unpaid"
        | "paused"
      visit_status: "paid" | "pending" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      bug_severity: ["low", "medium", "high", "critical"],
      bug_status: ["open", "in_progress", "fixed", "wontfix", "duplicate"],
      expense_recurrence: ["none", "weekly", "monthly"],
      insight_severity: ["info", "warning", "critical"],
      messenger_channel: [
        "telegram",
        "whatsapp",
        "instagram",
        "facebook",
        "internal",
      ],
      payment_method: ["cash", "card", "transfer", "online", "mixed"],
      payout_status: ["draft", "paid"],
      payroll_kind: ["advance", "final"],
      salon_role: ["owner", "admin", "staff", "accountant"],
      scheduled_payment_status: ["pending", "paid"],
      staff_block_kind: ["reservation", "absence"],
      staff_payout_scheme: [
        "fixed",
        "percent_revenue",
        "percent_service",
        "chair_rent",
        "mixed",
      ],
      subscription_status: [
        "trialing",
        "active",
        "past_due",
        "canceled",
        "incomplete",
        "incomplete_expired",
        "unpaid",
        "paused",
      ],
      visit_status: ["paid", "pending", "cancelled"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
