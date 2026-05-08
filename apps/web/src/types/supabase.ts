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
      audit_log: {
        Row: {
          action: string
          created_at: string
          diff: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: unknown
          salon_id: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          diff?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: unknown
          salon_id: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          diff?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: unknown
          salon_id?: string
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
      bug_reports: {
        Row: {
          ai_categorized_at: string | null
          ai_steps_to_repro: string | null
          ai_summary: string | null
          area: string | null
          attachments: Json
          created_at: string
          duplicate_of: string | null
          fixed_at: string | null
          fixed_in_commit: string | null
          id: string
          message_text: string | null
          notes: string | null
          reported_at: string
          sender_first_name: string | null
          sender_id: number
          sender_username: string | null
          severity: Database["public"]["Enums"]["bug_severity"] | null
          status: Database["public"]["Enums"]["bug_status"]
          telegram_chat_id: number
          telegram_message_id: number
          telegram_thread_id: number | null
          updated_at: string
        }
        Insert: {
          ai_categorized_at?: string | null
          ai_steps_to_repro?: string | null
          ai_summary?: string | null
          area?: string | null
          attachments?: Json
          created_at?: string
          duplicate_of?: string | null
          fixed_at?: string | null
          fixed_in_commit?: string | null
          id?: string
          message_text?: string | null
          notes?: string | null
          reported_at?: string
          sender_first_name?: string | null
          sender_id: number
          sender_username?: string | null
          severity?: Database["public"]["Enums"]["bug_severity"] | null
          status?: Database["public"]["Enums"]["bug_status"]
          telegram_chat_id: number
          telegram_message_id: number
          telegram_thread_id?: number | null
          updated_at?: string
        }
        Update: {
          ai_categorized_at?: string | null
          ai_steps_to_repro?: string | null
          ai_summary?: string | null
          area?: string | null
          attachments?: Json
          created_at?: string
          duplicate_of?: string | null
          fixed_at?: string | null
          fixed_in_commit?: string | null
          id?: string
          message_text?: string | null
          notes?: string | null
          reported_at?: string
          sender_first_name?: string | null
          sender_id?: number
          sender_username?: string | null
          severity?: Database["public"]["Enums"]["bug_severity"] | null
          status?: Database["public"]["Enums"]["bug_status"]
          telegram_chat_id?: number
          telegram_message_id?: number
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
      clients: {
        Row: {
          birthday: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          external_id: string | null
          external_source: string | null
          id: string
          last_visit_at: string | null
          name: string
          notes: string | null
          phone: string | null
          salon_id: string
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
          email?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          last_visit_at?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          salon_id: string
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
          email?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          last_visit_at?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          salon_id?: string
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
          is_system: boolean
          monthly_budget_cents: number | null
          name: string
          salon_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          is_system?: boolean
          monthly_budget_cents?: number | null
          name: string
          salon_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          is_system?: boolean
          monthly_budget_cents?: number | null
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
          category_id: string | null
          comment: string | null
          contractor_name: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          expense_at: string
          external_id: string | null
          id: string
          invoice_number: string | null
          is_recurring: boolean
          next_occurrence_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          receipt_storage_path: string | null
          receipt_url: string | null
          recurrence: Database["public"]["Enums"]["expense_recurrence"]
          recurrence_parent_id: string | null
          recurring_period: string | null
          salon_id: string
          source: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          category_id?: string | null
          comment?: string | null
          contractor_name?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          expense_at: string
          external_id?: string | null
          id?: string
          invoice_number?: string | null
          is_recurring?: boolean
          next_occurrence_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          receipt_storage_path?: string | null
          receipt_url?: string | null
          recurrence?: Database["public"]["Enums"]["expense_recurrence"]
          recurrence_parent_id?: string | null
          recurring_period?: string | null
          salon_id: string
          source?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          category_id?: string | null
          comment?: string | null
          contractor_name?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          expense_at?: string
          external_id?: string | null
          id?: string
          invoice_number?: string | null
          is_recurring?: boolean
          next_occurrence_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          receipt_storage_path?: string | null
          receipt_url?: string | null
          recurrence?: Database["public"]["Enums"]["expense_recurrence"]
          recurrence_parent_id?: string | null
          recurring_period?: string | null
          salon_id?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
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
          locale: string
          telegram_id: number | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          locale?: string
          telegram_id?: number | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          locale?: string
          telegram_id?: number | null
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
      salon_integrations: {
        Row: {
          connected_at: string
          credentials: Json
          id: string
          last_error: string | null
          last_sync_at: string | null
          last_sync_stats: Json | null
          provider: string
          salon_id: string
          status: string
          sync_interval_minutes: number
          updated_at: string
        }
        Insert: {
          connected_at?: string
          credentials?: Json
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          last_sync_stats?: Json | null
          provider: string
          salon_id: string
          status?: string
          sync_interval_minutes?: number
          updated_at?: string
        }
        Update: {
          connected_at?: string
          credentials?: Json
          id?: string
          last_error?: string | null
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
          cancelled_at: string | null
          email: string
          expires_at: string
          id: string
          invited_at: string
          invited_by: string
          role: Database["public"]["Enums"]["salon_role"]
          salon_id: string
          staff_id: string | null
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          cancelled_at?: string | null
          email: string
          expires_at?: string
          id?: string
          invited_at?: string
          invited_by: string
          role?: Database["public"]["Enums"]["salon_role"]
          salon_id: string
          staff_id?: string | null
          token: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          cancelled_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          invited_at?: string
          invited_by?: string
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
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string
          current_period_start: string
          id: string
          salon_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string
          stripe_price_id: string
          stripe_subscription_id: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end: string
          current_period_start: string
          id?: string
          salon_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string
          stripe_price_id: string
          stripe_subscription_id: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          salon_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string
          stripe_price_id?: string
          stripe_subscription_id?: string
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
          benchmarks_opt_in: boolean
          country_code: string
          created_at: string
          created_by: string
          currency: string
          deleted_at: string | null
          id: string
          locale: string
          logo_url: string | null
          name: string
          opening_cash_balance_cents: number
          salon_type: string
          timezone: string
          updated_at: string
          weekly_digest_enabled: boolean
        }
        Insert: {
          benchmarks_opt_in?: boolean
          country_code: string
          created_at?: string
          created_by: string
          currency?: string
          deleted_at?: string | null
          id?: string
          locale?: string
          logo_url?: string | null
          name: string
          opening_cash_balance_cents?: number
          salon_type: string
          timezone?: string
          updated_at?: string
          weekly_digest_enabled?: boolean
        }
        Update: {
          benchmarks_opt_in?: boolean
          country_code?: string
          created_at?: string
          created_by?: string
          currency?: string
          deleted_at?: string | null
          id?: string
          locale?: string
          logo_url?: string | null
          name?: string
          opening_cash_balance_cents?: number
          salon_type?: string
          timezone?: string
          updated_at?: string
          weekly_digest_enabled?: boolean
        }
        Relationships: []
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
      services: {
        Row: {
          category_id: string | null
          created_at: string
          default_duration_min: number | null
          default_price_cents: number
          external_id: string | null
          external_source: string | null
          id: string
          is_archived: boolean
          name: string
          salon_id: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          default_duration_min?: number | null
          default_price_cents?: number
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_archived?: boolean
          name: string
          salon_id: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          default_duration_min?: number | null
          default_price_cents?: number
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_archived?: boolean
          name?: string
          salon_id?: string
          updated_at?: string
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
          chair_rent_cents: number | null
          created_at: string
          deleted_at: string | null
          display_color: string | null
          external_id: string | null
          external_source: string | null
          full_name: string
          id: string
          is_active: boolean
          payout_fixed_cents: number | null
          payout_percent: number | null
          payout_scheme: Database["public"]["Enums"]["staff_payout_scheme"]
          salon_id: string
          updated_at: string
        }
        Insert: {
          chair_rent_cents?: number | null
          created_at?: string
          deleted_at?: string | null
          display_color?: string | null
          external_id?: string | null
          external_source?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          payout_fixed_cents?: number | null
          payout_percent?: number | null
          payout_scheme?: Database["public"]["Enums"]["staff_payout_scheme"]
          salon_id: string
          updated_at?: string
        }
        Update: {
          chair_rent_cents?: number | null
          created_at?: string
          deleted_at?: string | null
          display_color?: string | null
          external_id?: string | null
          external_source?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          payout_fixed_cents?: number | null
          payout_percent?: number | null
          payout_scheme?: Database["public"]["Enums"]["staff_payout_scheme"]
          salon_id?: string
          updated_at?: string
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
          client_id: string | null
          comment: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          discount_cents: number
          external_id: string | null
          group_key: string | null
          id: string
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
          client_id?: string | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          discount_cents?: number
          external_id?: string | null
          group_key?: string | null
          id?: string
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
          client_id?: string | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          discount_cents?: number
          external_id?: string | null
          group_key?: string | null
          id?: string
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
    }
    Views: {
      salon_integrations_public: {
        Row: {
          connected_at: string | null
          id: string | null
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
          connected_at?: string | null
          id?: string | null
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
          connected_at?: string | null
          id?: string | null
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
          p_period_end: string
          p_period_start: string
          p_salon_id: string
        }
        Returns: {
          payouts_created: number
          total_expense_cents: number
        }[]
      }
      compute_benchmarks: { Args: never; Returns: number }
      compute_cash_balance: { Args: { p_salon_id: string }; Returns: number }
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
      cron_run_booksy_syncs: { Args: never; Returns: number }
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
      is_salon_admin: { Args: { p_salon_id: string }; Returns: boolean }
      is_salon_owner: { Args: { p_salon_id: string }; Returns: boolean }
      month_forecast: { Args: { p_salon_id: string }; Returns: Json }
      my_staff_id: { Args: { p_salon_id: string }; Returns: string }
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
      top_services_by_revenue: {
        Args: {
          p_limit?: number
          p_period_end: string
          p_period_start: string
          p_salon_id: string
        }
        Returns: {
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
      payment_method: "cash" | "card" | "transfer" | "online" | "mixed"
      payout_status: "draft" | "paid"
      salon_role: "owner" | "admin" | "staff" | "accountant"
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
  public: {
    Enums: {
      bug_severity: ["low", "medium", "high", "critical"],
      bug_status: ["open", "in_progress", "fixed", "wontfix", "duplicate"],
      expense_recurrence: ["none", "weekly", "monthly"],
      insight_severity: ["info", "warning", "critical"],
      payment_method: ["cash", "card", "transfer", "online", "mixed"],
      payout_status: ["draft", "paid"],
      salon_role: ["owner", "admin", "staff", "accountant"],
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
} as const
