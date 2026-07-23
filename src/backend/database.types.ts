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
      activity_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          detail: Json
          event_id: string
          id: number
          member_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          event_id: string
          id?: never
          member_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          event_id?: string
          id?: never
          member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      event_integrations: {
        Row: {
          config: Json
          connected_at: string | null
          created_at: string
          event_id: string
          external_space_id: string
          external_space_name: string | null
          id: string
          installation_id: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          status: Database["public"]["Enums"]["integration_status"]
          updated_at: string
        }
        Insert: {
          config?: Json
          connected_at?: string | null
          created_at?: string
          event_id: string
          external_space_id: string
          external_space_name?: string | null
          id?: string
          installation_id?: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          status?: Database["public"]["Enums"]["integration_status"]
          updated_at?: string
        }
        Update: {
          config?: Json
          connected_at?: string | null
          created_at?: string
          event_id?: string
          external_space_id?: string
          external_space_name?: string | null
          id?: string
          installation_id?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          status?: Database["public"]["Enums"]["integration_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_integrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          capacity: number
          created_at: string
          end_date: string
          event_type: Database["public"]["Enums"]["event_type"]
          finalized_at: string | null
          id: string
          organizer_user_id: string
          share_token: string
          start_date: string
          status: Database["public"]["Enums"]["event_status"]
          title: string
          updated_at: string
        }
        Insert: {
          capacity: number
          created_at?: string
          end_date: string
          event_type: Database["public"]["Enums"]["event_type"]
          finalized_at?: string | null
          id?: string
          organizer_user_id: string
          share_token: string
          start_date: string
          status?: Database["public"]["Enums"]["event_status"]
          title: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          end_date?: string
          event_type?: Database["public"]["Enums"]["event_type"]
          finalized_at?: string | null
          id?: string
          organizer_user_id?: string
          share_token?: string
          start_date?: string
          status?: Database["public"]["Enums"]["event_status"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      expense_targets: {
        Row: {
          expense_id: string
          fixed_amount: number | null
          member_id: string
        }
        Insert: {
          expense_id: string
          fixed_amount?: number | null
          member_id: string
        }
        Update: {
          expense_id?: string
          fixed_amount?: number | null
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_targets_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_targets_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          created_by_member_id: string
          day_index: number | null
          event_id: string
          id: string
          payer_member_id: string
          split_method: Database["public"]["Enums"]["split_method"]
          status: Database["public"]["Enums"]["expense_status"]
          title: string
          updated_at: string
        }
        Insert: {
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by_member_id: string
          day_index?: number | null
          event_id: string
          id?: string
          payer_member_id: string
          split_method?: Database["public"]["Enums"]["split_method"]
          status?: Database["public"]["Enums"]["expense_status"]
          title: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by_member_id?: string
          day_index?: number | null
          event_id?: string
          id?: string
          payer_member_id?: string
          split_method?: Database["public"]["Enums"]["split_method"]
          status?: Database["public"]["Enums"]["expense_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_payer_member_id_fkey"
            columns: ["payer_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_claim_tokens: {
        Row: {
          claimed_at: string | null
          created_at: string
          event_id: string
          expires_at: string
          id: string
          member_id: string
          token_hash: string
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          event_id: string
          expires_at: string
          id?: string
          member_id: string
          token_hash: string
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          event_id?: string
          expires_at?: string
          id?: string
          member_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_claim_tokens_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_claim_tokens_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_external_accounts: {
        Row: {
          created_at: string
          display_name: string | null
          external_user_id: string
          id: string
          member_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          external_user_id: string
          id?: string
          member_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          external_user_id?: string
          id?: string
          member_id?: string
          provider?: Database["public"]["Enums"]["integration_provider"]
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_external_accounts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_payment_profiles: {
        Row: {
          accepts_cash: boolean
          member_id: string
          paypay_id: string | null
          updated_at: string
        }
        Insert: {
          accepts_cash?: boolean
          member_id: string
          paypay_id?: string | null
          updated_at?: string
        }
        Update: {
          accepts_cash?: boolean
          member_id?: string
          paypay_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_payment_profiles_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          claimed_at: string | null
          created_at: string
          device_token_hash: string | null
          event_id: string
          id: string
          is_organizer: boolean
          name: string
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          device_token_hash?: string | null
          event_id: string
          id?: string
          is_organizer?: boolean
          name: string
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          device_token_hash?: string | null
          event_id?: string
          id?: string
          is_organizer?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          attempt: number
          created_at: string
          error_message: string | null
          id: number
          job_id: string
          provider: Database["public"]["Enums"]["integration_provider"] | null
          provider_message_id: string | null
          response: Json | null
          status: Database["public"]["Enums"]["notification_status"]
        }
        Insert: {
          attempt: number
          created_at?: string
          error_message?: string | null
          id?: never
          job_id: string
          provider?: Database["public"]["Enums"]["integration_provider"] | null
          provider_message_id?: string | null
          response?: Json | null
          status: Database["public"]["Enums"]["notification_status"]
        }
        Update: {
          attempt?: number
          created_at?: string
          error_message?: string | null
          id?: never
          job_id?: string
          provider?: Database["public"]["Enums"]["integration_provider"] | null
          provider_message_id?: string | null
          response?: Json | null
          status?: Database["public"]["Enums"]["notification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "notification_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_jobs: {
        Row: {
          attempts: number
          created_at: string
          dedupe_key: string | null
          event_id: string
          id: string
          integration_id: string | null
          last_error: string | null
          max_attempts: number
          member_id: string | null
          notification_type: string
          payload: Json
          processed_at: string | null
          scheduled_for: string
          status: Database["public"]["Enums"]["notification_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          dedupe_key?: string | null
          event_id: string
          id?: string
          integration_id?: string | null
          last_error?: string | null
          max_attempts?: number
          member_id?: string | null
          notification_type: string
          payload?: Json
          processed_at?: string | null
          scheduled_for?: string
          status?: Database["public"]["Enums"]["notification_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          dedupe_key?: string | null
          event_id?: string
          id?: string
          integration_id?: string | null
          last_error?: string | null
          max_attempts?: number
          member_id?: string | null
          notification_type?: string
          payload?: Json
          processed_at?: string | null
          scheduled_for?: string
          status?: Database["public"]["Enums"]["notification_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_jobs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_jobs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "event_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_jobs_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_items: {
        Row: {
          amount: number
          direction: Database["public"]["Enums"]["settlement_item_direction"]
          expense_id: string
          settlement_id: string
        }
        Insert: {
          amount: number
          direction: Database["public"]["Enums"]["settlement_item_direction"]
          expense_id: string
          settlement_id: string
        }
        Update: {
          amount?: number
          direction?: Database["public"]["Enums"]["settlement_item_direction"]
          expense_id?: string
          settlement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_items_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_items_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_payment_links: {
        Row: {
          created_by_member_id: string
          paypay_request_url: string
          settlement_id: string
          updated_at: string
        }
        Insert: {
          created_by_member_id: string
          paypay_request_url: string
          settlement_id: string
          updated_at?: string
        }
        Update: {
          created_by_member_id?: string
          paypay_request_url?: string
          settlement_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_payment_links_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_payment_links_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: true
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          amount: number
          confirmed_at: string | null
          confirmed_by_member_id: string | null
          created_at: string
          event_id: string
          from_member_id: string
          gross_amount: number
          id: string
          offset_amount: number
          reported_at: string | null
          reported_by_member_id: string | null
          status: Database["public"]["Enums"]["settlement_status"]
          to_member_id: string
        }
        Insert: {
          amount: number
          confirmed_at?: string | null
          confirmed_by_member_id?: string | null
          created_at?: string
          event_id: string
          from_member_id: string
          gross_amount: number
          id?: string
          offset_amount: number
          reported_at?: string | null
          reported_by_member_id?: string | null
          status?: Database["public"]["Enums"]["settlement_status"]
          to_member_id: string
        }
        Update: {
          amount?: number
          confirmed_at?: string | null
          confirmed_by_member_id?: string | null
          created_at?: string
          event_id?: string
          from_member_id?: string
          gross_amount?: number
          id?: string
          offset_amount?: number
          reported_at?: string | null
          reported_by_member_id?: string | null
          status?: Database["public"]["Enums"]["settlement_status"]
          to_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_confirmed_by_member_id_fkey"
            columns: ["confirmed_by_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_from_member_id_fkey"
            columns: ["from_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_reported_by_member_id_fkey"
            columns: ["reported_by_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_to_member_id_fkey"
            columns: ["to_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_expense: {
        Args: {
          p_amount: number
          p_category: Database["public"]["Enums"]["expense_category"]
          p_day_index: number
          p_device_token: string
          p_payer_member_id: string
          p_share_token: string
          p_split_method: Database["public"]["Enums"]["split_method"]
          p_targets: Json
          p_title: string
        }
        Returns: Json
      }
      claim_member: {
        Args: {
          p_claim_token: string
          p_device_token: string
          p_share_token: string
        }
        Returns: Json
      }
      confirm_settlement: {
        Args: {
          p_device_token: string
          p_settlement_id: string
          p_share_token: string
        }
        Returns: undefined
      }
      create_event: {
        Args: {
          p_capacity?: number
          p_end_date: string
          p_event_type: Database["public"]["Enums"]["event_type"]
          p_start_date: string
          p_title: string
        }
        Returns: Json
      }
      delete_expense: {
        Args: {
          p_device_token: string
          p_expense_id: string
          p_share_token: string
        }
        Returns: undefined
      }
      finalize_event: { Args: { p_event_id: string }; Returns: Json }
      finalize_expense: {
        Args: {
          p_device_token: string
          p_expense_id: string
          p_share_token: string
        }
        Returns: undefined
      }
      get_event_state:
        | { Args: { p_share_token: string }; Returns: Json }
        | {
            Args: { p_device_token: string; p_share_token: string }
            Returns: Json
          }
      get_payment_state: {
        Args: { p_device_token?: string; p_share_token: string }
        Returns: Json
      }
      join_event: {
        Args: { p_device_token: string; p_name: string; p_share_token: string }
        Returns: Json
      }
      organizer_add_member: {
        Args: { p_event_id: string; p_name: string }
        Returns: Json
      }
      organizer_issue_claim_token: {
        Args: { p_event_id: string; p_member_id: string }
        Returns: Json
      }
      organizer_queue_notification: {
        Args: {
          p_dedupe_key?: string
          p_event_id: string
          p_integration_id?: string
          p_member_id?: string
          p_notification_type: string
          p_payload?: Json
          p_scheduled_for?: string
        }
        Returns: string
      }
      organizer_remove_member: {
        Args: { p_event_id: string; p_member_id: string }
        Returns: undefined
      }
      organizer_regenerate_share_token: {
        Args: { p_event_id: string }
        Returns: Json
      }
      organizer_update_event: {
        Args: {
          p_capacity: number
          p_end_date: string
          p_event_id: string
          p_event_type: Database["public"]["Enums"]["event_type"]
          p_start_date: string
          p_title: string
        }
        Returns: Json
      }
      organizer_upsert_integration: {
        Args: {
          p_event_id: string
          p_external_space_id: string
          p_external_space_name?: string
          p_provider: Database["public"]["Enums"]["integration_provider"]
        }
        Returns: {
          config: Json
          connected_at: string | null
          created_at: string
          event_id: string
          external_space_id: string
          external_space_name: string | null
          id: string
          installation_id: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          status: Database["public"]["Enums"]["integration_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "event_integrations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      report_settlement: {
        Args: {
          p_device_token: string
          p_settlement_id: string
          p_share_token: string
        }
        Returns: undefined
      }
      revert_settlement: {
        Args: {
          p_device_token: string
          p_settlement_id: string
          p_share_token: string
        }
        Returns: Database["public"]["Enums"]["settlement_status"]
      }
      save_own_fixed_amount: {
        Args: {
          p_device_token: string
          p_expense_id: string
          p_fixed_amount?: number
          p_share_token: string
        }
        Returns: undefined
      }
      set_settlement_payment_link: {
        Args: {
          p_device_token: string
          p_paypay_request_url?: string
          p_settlement_id: string
          p_share_token: string
        }
        Returns: undefined
      }
      unfinalize_event: {
        Args: { p_event_id: string; p_force?: boolean }
        Returns: Json
      }
      upsert_payment_profile: {
        Args: {
          p_accepts_cash?: boolean
          p_device_token: string
          p_paypay_id?: string
          p_share_token: string
        }
        Returns: Json
      }
      update_expense: {
        Args: {
          p_amount: number
          p_category: Database["public"]["Enums"]["expense_category"]
          p_day_index: number
          p_device_token: string
          p_expense_id: string
          p_payer_member_id: string
          p_share_token: string
          p_split_method: Database["public"]["Enums"]["split_method"]
          p_targets: Json
          p_title: string
        }
        Returns: Json
      }
    }
    Enums: {
      event_status: "active" | "finalized"
      event_type: "single_day" | "overnight"
      expense_category:
        | "lodging"
        | "transport"
        | "food"
        | "activity"
        | "shopping"
        | "other"
      expense_status: "draft" | "finalized"
      integration_provider: "line" | "discord"
      integration_status: "pending" | "active" | "disabled" | "error"
      notification_status:
        | "pending"
        | "processing"
        | "sent"
        | "failed"
        | "cancelled"
      settlement_item_direction: "charge" | "offset"
      settlement_status: "pending" | "reported" | "paid"
      split_method: "equal" | "fixed"
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
      event_status: ["active", "finalized"],
      event_type: ["single_day", "overnight"],
      expense_category: [
        "lodging",
        "transport",
        "food",
        "activity",
        "shopping",
        "other",
      ],
      expense_status: ["draft", "finalized"],
      integration_provider: ["line", "discord"],
      integration_status: ["pending", "active", "disabled", "error"],
      notification_status: [
        "pending",
        "processing",
        "sent",
        "failed",
        "cancelled",
      ],
      settlement_item_direction: ["charge", "offset"],
      settlement_status: ["pending", "reported", "paid"],
      split_method: ["equal", "fixed"],
    },
  },
} as const
