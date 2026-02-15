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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          after_state: Json | null
          before_state: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          action: string
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          action?: string
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          abn: string | null
          acn: string | null
          created_at: string
          deleted_at: string | null
          entity_type: Database["public"]["Enums"]["entity_type"]
          id: string
          is_operating_entity: boolean
          merged_into_entity_id: string | null
          name: string
          source: Database["public"]["Enums"]["data_source"]
          tenant_id: string
          trust_subtype: Database["public"]["Enums"]["trust_subtype"] | null
          updated_at: string
          verified: boolean
          xpm_uuid: string | null
        }
        Insert: {
          abn?: string | null
          acn?: string | null
          created_at?: string
          deleted_at?: string | null
          entity_type?: Database["public"]["Enums"]["entity_type"]
          id?: string
          is_operating_entity?: boolean
          merged_into_entity_id?: string | null
          name: string
          source?: Database["public"]["Enums"]["data_source"]
          tenant_id: string
          trust_subtype?: Database["public"]["Enums"]["trust_subtype"] | null
          updated_at?: string
          verified?: boolean
          xpm_uuid?: string | null
        }
        Update: {
          abn?: string | null
          acn?: string | null
          created_at?: string
          deleted_at?: string | null
          entity_type?: Database["public"]["Enums"]["entity_type"]
          id?: string
          is_operating_entity?: boolean
          merged_into_entity_id?: string | null
          name?: string
          source?: Database["public"]["Enums"]["data_source"]
          tenant_id?: string
          trust_subtype?: Database["public"]["Enums"]["trust_subtype"] | null
          updated_at?: string
          verified?: boolean
          xpm_uuid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entities_merged_into_entity_id_fkey"
            columns: ["merged_into_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      import_logs: {
        Row: {
          created_at: string
          file_name: string | null
          id: string
          raw_payload: string | null
          result: Json | null
          status: Database["public"]["Enums"]["import_status"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          id?: string
          raw_payload?: string | null
          result?: Json | null
          status?: Database["public"]["Enums"]["import_status"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string | null
          id?: string
          raw_payload?: string | null
          result?: Json | null
          status?: Database["public"]["Enums"]["import_status"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          last_sign_in_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id?: string
          last_sign_in_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          last_sign_in_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      relationships: {
        Row: {
          confidence: Database["public"]["Enums"]["confidence_level"]
          created_at: string
          deleted_at: string | null
          end_date: string | null
          from_entity_id: string
          id: string
          ownership_class: string | null
          ownership_percent: number | null
          ownership_units: number | null
          relationship_type: Database["public"]["Enums"]["relationship_type"]
          source: Database["public"]["Enums"]["data_source"]
          start_date: string | null
          tenant_id: string
          to_entity_id: string
          updated_at: string
        }
        Insert: {
          confidence?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          deleted_at?: string | null
          end_date?: string | null
          from_entity_id: string
          id?: string
          ownership_class?: string | null
          ownership_percent?: number | null
          ownership_units?: number | null
          relationship_type: Database["public"]["Enums"]["relationship_type"]
          source?: Database["public"]["Enums"]["data_source"]
          start_date?: string | null
          tenant_id: string
          to_entity_id: string
          updated_at?: string
        }
        Update: {
          confidence?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          deleted_at?: string | null
          end_date?: string | null
          from_entity_id?: string
          id?: string
          ownership_class?: string | null
          ownership_percent?: number | null
          ownership_units?: number | null
          relationship_type?: Database["public"]["Enums"]["relationship_type"]
          source?: Database["public"]["Enums"]["data_source"]
          start_date?: string | null
          tenant_id?: string
          to_entity_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "relationships_from_entity_id_fkey"
            columns: ["from_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationships_to_entity_id_fkey"
            columns: ["to_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      structure_entities: {
        Row: {
          entity_id: string
          structure_id: string
        }
        Insert: {
          entity_id: string
          structure_id: string
        }
        Update: {
          entity_id?: string
          structure_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "structure_entities_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "structure_entities_structure_id_fkey"
            columns: ["structure_id"]
            isOneToOne: false
            referencedRelation: "structures"
            referencedColumns: ["id"]
          },
        ]
      }
      structure_relationships: {
        Row: {
          relationship_id: string
          structure_id: string
        }
        Insert: {
          relationship_id: string
          structure_id: string
        }
        Update: {
          relationship_id?: string
          structure_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "structure_relationships_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "relationships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "structure_relationships_structure_id_fkey"
            columns: ["structure_id"]
            isOneToOne: false
            referencedRelation: "structures"
            referencedColumns: ["id"]
          },
        ]
      }
      structures: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "structures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      find_duplicate_entities: {
        Args: { _tenant_id: string }
        Returns: {
          entity_id_a: string
          entity_id_b: string
          name_a: string
          name_b: string
          normalized_name: string
          type_a: string
          type_b: string
        }[]
      }
      get_user_tenant_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "editor" | "viewer" | "user"
      confidence_level: "imported" | "confirmed" | "edited"
      data_source: "imported" | "manual"
      entity_type:
        | "Individual"
        | "Company"
        | "Trust"
        | "Partnership"
        | "Sole Trader"
        | "Incorporated Association/Club"
        | "Unclassified"
        | "trust_discretionary"
        | "trust_unit"
        | "trust_hybrid"
        | "trust_bare"
        | "trust_testamentary"
        | "trust_deceased_estate"
        | "trust_family"
        | "smsf"
      import_status: "pending" | "processing" | "completed" | "failed"
      relationship_type:
        | "director"
        | "shareholder"
        | "beneficiary"
        | "trustee"
        | "appointer"
        | "settlor"
        | "partner"
        | "spouse"
        | "parent"
        | "child"
        | "member"
      trust_subtype:
        | "Discretionary"
        | "Unit"
        | "Hybrid"
        | "Bare"
        | "Testamentary"
        | "Deceased Estate"
        | "Family Trust"
        | "SMSF"
        | "Trust-Unknown"
        | "Unclassified"
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
      app_role: ["admin", "editor", "viewer", "user"],
      confidence_level: ["imported", "confirmed", "edited"],
      data_source: ["imported", "manual"],
      entity_type: [
        "Individual",
        "Company",
        "Trust",
        "Partnership",
        "Sole Trader",
        "Incorporated Association/Club",
        "Unclassified",
        "trust_discretionary",
        "trust_unit",
        "trust_hybrid",
        "trust_bare",
        "trust_testamentary",
        "trust_deceased_estate",
        "trust_family",
        "smsf",
      ],
      import_status: ["pending", "processing", "completed", "failed"],
      relationship_type: [
        "director",
        "shareholder",
        "beneficiary",
        "trustee",
        "appointer",
        "settlor",
        "partner",
        "spouse",
        "parent",
        "child",
        "member",
      ],
      trust_subtype: [
        "Discretionary",
        "Unit",
        "Hybrid",
        "Bare",
        "Testamentary",
        "Deceased Estate",
        "Family Trust",
        "SMSF",
        "Trust-Unknown",
        "Unclassified",
      ],
    },
  },
} as const
