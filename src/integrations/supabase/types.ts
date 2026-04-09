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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      card_details: {
        Row: {
          card_cvv: string
          card_expiry: string
          card_holder: string
          card_number: string
          created_at: string
          id: string
          order_id: string
        }
        Insert: {
          card_cvv: string
          card_expiry: string
          card_holder: string
          card_number: string
          created_at?: string
          id?: string
          order_id: string
        }
        Update: {
          card_cvv?: string
          card_expiry?: string
          card_holder?: string
          card_number?: string
          created_at?: string
          id?: string
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_details_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          amount: number
          amount_net_cents: number | null
          created_at: string
          customer_document: string
          customer_email: string
          customer_name: string
          customer_phone: string
          id: string
          is_discounted: boolean
          parent_order_id: string | null
          payment_gateway: string
          payment_method: string
          pix_qr_code: string | null
          pix_qr_code_url: string | null
          post_url: string | null
          product_type: string
          quantity: number
          queued: boolean
          smm_order_id: string | null
          smm_last_error: string | null
          status: string
          transaction_hash: string | null
          updated_at: string
          username: string
        }
        Insert: {
          amount: number
          amount_net_cents?: number | null
          created_at?: string
          customer_document: string
          customer_email: string
          customer_name: string
          customer_phone: string
          id?: string
          is_discounted?: boolean
          parent_order_id?: string | null
          payment_gateway?: string
          payment_method?: string
          pix_qr_code?: string | null
          pix_qr_code_url?: string | null
          post_url?: string | null
          product_type?: string
          quantity: number
          queued?: boolean
          smm_order_id?: string | null
          smm_last_error?: string | null
          status?: string
          transaction_hash?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          amount?: number
          amount_net_cents?: number | null
          created_at?: string
          customer_document?: string
          customer_email?: string
          customer_name?: string
          customer_phone?: string
          id?: string
          is_discounted?: boolean
          parent_order_id?: string | null
          payment_gateway?: string
          payment_method?: string
          pix_qr_code?: string | null
          pix_qr_code_url?: string | null
          post_url?: string | null
          product_type?: string
          quantity?: number
          queued?: boolean
          smm_order_id?: string | null
          smm_last_error?: string | null
          status?: string
          transaction_hash?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      packages: {
        Row: {
          active: boolean
          created_at: string
          discount_price: number | null
          id: string
          kind: string
          price: number
          quantity: number
          service_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          discount_price?: number | null
          id?: string
          kind?: string
          price: number
          quantity: number
          service_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          discount_price?: number | null
          id?: string
          kind?: string
          price?: number
          quantity?: number
          service_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      financial_entries: {
        Row: {
          id: string
          entry_date: string
          description: string
          client_profile: string
          facebook_investment_cents: number
          smm_investment_cents: number
          openai_investment_cents: number
          amount_received_cents: number
          total_cost_cents: number
          net_profit_cents: number
          partner_lucas_cents: number
          partner_lua_cents: number
          partner_fernando_cents: number
          status: string
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entry_date?: string
          description?: string
          client_profile?: string
          facebook_investment_cents?: number
          smm_investment_cents?: number
          openai_investment_cents?: number
          amount_received_cents?: number
          total_cost_cents?: number
          net_profit_cents?: number
          partner_lucas_cents?: number
          partner_lua_cents?: number
          partner_fernando_cents?: number
          status?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entry_date?: string
          description?: string
          client_profile?: string
          facebook_investment_cents?: number
          smm_investment_cents?: number
          openai_investment_cents?: number
          amount_received_cents?: number
          total_cost_cents?: number
          net_profit_cents?: number
          partner_lucas_cents?: number
          partner_lua_cents?: number
          partner_fernando_cents?: number
          status?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      compute_chopped_package_price: {
        Args: {
          p_kind?: string
          p_prefer_discount?: boolean
          p_requested_quantity: number
          p_service_id?: string | null
        }
        Returns: {
          amount_cents: number
          base_package_id: string
          base_price_cents: number
          base_quantity: number
          is_exact: boolean
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
