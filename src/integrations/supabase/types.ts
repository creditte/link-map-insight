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
          is_trustee_company: boolean
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
          is_trustee_company?: boolean
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
          is_trustee_company?: boolean
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
      entity_merges: {
        Row: {
          id: string
          merged_at: string
          merged_by: string
          merged_entity_id: string
          primary_entity_id: string
          structure_id: string | null
          tenant_id: string
        }
        Insert: {
          id?: string
          merged_at?: string
          merged_by: string
          merged_entity_id: string
          primary_entity_id: string
          structure_id?: string | null
          tenant_id: string
        }
        Update: {
          id?: string
          merged_at?: string
          merged_by?: string
          merged_entity_id?: string
          primary_entity_id?: string
          structure_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_merges_merged_entity_id_fkey"
            columns: ["merged_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_merges_primary_entity_id_fkey"
            columns: ["primary_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_merges_structure_id_fkey"
            columns: ["structure_id"]
            isOneToOne: false
            referencedRelation: "structures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_merges_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          created_at: string
          id: string
          message: string
          metadata: Json | null
          page: string | null
          status: string
          structure_id: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          metadata?: Json | null
          page?: string | null
          status?: string
          structure_id?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          metadata?: Json | null
          page?: string | null
          status?: string
          structure_id?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_structure_id_fkey"
            columns: ["structure_id"]
            isOneToOne: false
            referencedRelation: "structures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_tenant_id_fkey"
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
      mfa_email_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          id: string
          used: boolean
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          id?: string
          used?: boolean
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          used?: boolean
          user_id?: string
        }
        Relationships: []
      }
      mfa_settings: {
        Row: {
          enrolled_at: string
          method: string
          user_id: string
        }
        Insert: {
          enrolled_at?: string
          method: string
          user_id: string
        }
        Update: {
          enrolled_at?: string
          method?: string
          user_id?: string
        }
        Relationships: []
      }
      mfa_verifications: {
        Row: {
          expires_at: string
          id: string
          method: string
          user_id: string
          verified_at: string
        }
        Insert: {
          expires_at: string
          id?: string
          method: string
          user_id: string
          verified_at?: string
        }
        Update: {
          expires_at?: string
          id?: string
          method?: string
          user_id?: string
          verified_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          last_sign_in_at: string | null
          onboarding_complete: boolean
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
          onboarding_complete?: boolean
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
          onboarding_complete?: boolean
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
      roles: {
        Row: {
          created_at: string
          id: string
          is_super_admin: boolean
          role_name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_super_admin?: boolean
          role_name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_super_admin?: boolean
          role_name?: string
        }
        Relationships: []
      }
      signup_verifications: {
        Row: {
          code: string
          created_at: string
          email: string
          expires_at: string
          id: string
          used: boolean
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          email: string
          expires_at: string
          id?: string
          used?: boolean
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          used?: boolean
          user_id?: string
        }
        Relationships: []
      }
      snapshot_entities: {
        Row: {
          abn: string | null
          acn: string | null
          entity_id: string
          entity_type: string
          id: string
          is_operating_entity: boolean
          is_trustee_company: boolean
          name: string
          position_x: number | null
          position_y: number | null
          snapshot_id: string
        }
        Insert: {
          abn?: string | null
          acn?: string | null
          entity_id: string
          entity_type: string
          id?: string
          is_operating_entity?: boolean
          is_trustee_company?: boolean
          name: string
          position_x?: number | null
          position_y?: number | null
          snapshot_id: string
        }
        Update: {
          abn?: string | null
          acn?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          is_operating_entity?: boolean
          is_trustee_company?: boolean
          name?: string
          position_x?: number | null
          position_y?: number | null
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "snapshot_entities_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "structure_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      snapshot_relationships: {
        Row: {
          from_entity_snapshot_id: string
          id: string
          ownership_class: string | null
          ownership_percent: number | null
          ownership_units: number | null
          relationship_type: string
          snapshot_id: string
          to_entity_snapshot_id: string
        }
        Insert: {
          from_entity_snapshot_id: string
          id?: string
          ownership_class?: string | null
          ownership_percent?: number | null
          ownership_units?: number | null
          relationship_type: string
          snapshot_id: string
          to_entity_snapshot_id: string
        }
        Update: {
          from_entity_snapshot_id?: string
          id?: string
          ownership_class?: string | null
          ownership_percent?: number | null
          ownership_units?: number | null
          relationship_type?: string
          snapshot_id?: string
          to_entity_snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "snapshot_relationships_from_entity_snapshot_id_fkey"
            columns: ["from_entity_snapshot_id"]
            isOneToOne: false
            referencedRelation: "snapshot_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "snapshot_relationships_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "structure_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "snapshot_relationships_to_entity_snapshot_id_fkey"
            columns: ["to_entity_snapshot_id"]
            isOneToOne: false
            referencedRelation: "snapshot_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          event_type: string
          id: string
          payload: Json | null
          processed_at: string
        }
        Insert: {
          event_type: string
          id: string
          payload?: Json | null
          processed_at?: string
        }
        Update: {
          event_type?: string
          id?: string
          payload?: Json | null
          processed_at?: string
        }
        Relationships: []
      }
      structure_entities: {
        Row: {
          entity_id: string
          position_x: number | null
          position_y: number | null
          structure_id: string
        }
        Insert: {
          entity_id: string
          position_x?: number | null
          position_y?: number | null
          structure_id: string
        }
        Update: {
          entity_id?: string
          position_x?: number | null
          position_y?: number | null
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
      structure_snapshots: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          name: string
          structure_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          name: string
          structure_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name?: string
          structure_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "structure_snapshots_structure_id_fkey"
            columns: ["structure_id"]
            isOneToOne: false
            referencedRelation: "structures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "structure_snapshots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      structures: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_scenario: boolean
          layout_mode: Database["public"]["Enums"]["layout_mode"]
          name: string
          parent_structure_id: string | null
          scenario_label: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_scenario?: boolean
          layout_mode?: Database["public"]["Enums"]["layout_mode"]
          name: string
          parent_structure_id?: string | null
          scenario_label?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_scenario?: boolean
          layout_mode?: Database["public"]["Enums"]["layout_mode"]
          name?: string
          parent_structure_id?: string | null
          scenario_label?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "structures_parent_structure_id_fkey"
            columns: ["parent_structure_id"]
            isOneToOne: false
            referencedRelation: "structures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "structures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      super_admins: {
        Row: {
          auth_user_id: string
          created_at: string
          display_name: string | null
          email: string
          id: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
        }
        Relationships: []
      }
      tenant_user_audit_log: {
        Row: {
          action: string
          actor_auth_user_id: string
          created_at: string
          id: string
          meta: Json | null
          target_email: string | null
          target_tenant_user_id: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_auth_user_id: string
          created_at?: string
          id?: string
          meta?: Json | null
          target_email?: string | null
          target_tenant_user_id?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_auth_user_id?: string
          created_at?: string
          id?: string
          meta?: Json | null
          target_email?: string | null
          target_tenant_user_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tenant_users: {
        Row: {
          accepted_at: string | null
          auth_user_id: string | null
          can_manage_integrations: boolean
          created_at: string
          deleted_at: string | null
          disabled_at: string | null
          display_name: string | null
          email: string
          id: string
          invited_at: string | null
          invited_by: string | null
          last_invited_at: string | null
          role: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          auth_user_id?: string | null
          can_manage_integrations?: boolean
          created_at?: string
          deleted_at?: string | null
          disabled_at?: string | null
          display_name?: string | null
          email: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          last_invited_at?: string | null
          role?: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          auth_user_id?: string | null
          can_manage_integrations?: boolean
          created_at?: string
          deleted_at?: string | null
          disabled_at?: string | null
          display_name?: string | null
          email?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          last_invited_at?: string | null
          role?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          access_enabled: boolean | null
          access_locked_reason: string | null
          allow_admin_integrations: boolean
          brand_primary_color: string | null
          cancel_at_period_end: boolean | null
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          diagram_count: number | null
          diagram_limit: number | null
          export_block_on_critical_health: boolean
          export_default_view_mode: string
          export_disclaimer_text: string | null
          export_footer_text: string | null
          export_show_disclaimer: boolean
          firm_name: string
          id: string
          logo_url: string | null
          name: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_plan: string | null
          subscription_status: string
          trial_ends_at: string | null
          trial_starts_at: string | null
          trial_used_at: string | null
          updated_at: string
        }
        Insert: {
          access_enabled?: boolean | null
          access_locked_reason?: string | null
          allow_admin_integrations?: boolean
          brand_primary_color?: string | null
          cancel_at_period_end?: boolean | null
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          diagram_count?: number | null
          diagram_limit?: number | null
          export_block_on_critical_health?: boolean
          export_default_view_mode?: string
          export_disclaimer_text?: string | null
          export_footer_text?: string | null
          export_show_disclaimer?: boolean
          firm_name?: string
          id?: string
          logo_url?: string | null
          name: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_plan?: string | null
          subscription_status?: string
          trial_ends_at?: string | null
          trial_starts_at?: string | null
          trial_used_at?: string | null
          updated_at?: string
        }
        Update: {
          access_enabled?: boolean | null
          access_locked_reason?: string | null
          allow_admin_integrations?: boolean
          brand_primary_color?: string | null
          cancel_at_period_end?: boolean | null
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          diagram_count?: number | null
          diagram_limit?: number | null
          export_block_on_critical_health?: boolean
          export_default_view_mode?: string
          export_disclaimer_text?: string | null
          export_footer_text?: string | null
          export_show_disclaimer?: boolean
          firm_name?: string
          id?: string
          logo_url?: string | null
          name?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_plan?: string | null
          subscription_status?: string
          trial_ends_at?: string | null
          trial_starts_at?: string | null
          trial_used_at?: string | null
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
      xero_connections: {
        Row: {
          access_token: string
          connected_at: string | null
          connected_by_email: string | null
          created_at: string | null
          expires_at: string
          id: string
          refresh_token: string
          tenant_id: string
          updated_at: string | null
          user_id: string
          xero_org_name: string | null
          xero_tenant_id: string | null
        }
        Insert: {
          access_token: string
          connected_at?: string | null
          connected_by_email?: string | null
          created_at?: string | null
          expires_at: string
          id?: string
          refresh_token: string
          tenant_id: string
          updated_at?: string | null
          user_id: string
          xero_org_name?: string | null
          xero_tenant_id?: string | null
        }
        Update: {
          access_token?: string
          connected_at?: string | null
          connected_by_email?: string | null
          created_at?: string | null
          expires_at?: string
          id?: string
          refresh_token?: string
          tenant_id?: string
          updated_at?: string | null
          user_id?: string
          xero_org_name?: string | null
          xero_tenant_id?: string | null
        }
        Relationships: []
      }
      xero_oauth_states: {
        Row: {
          created_at: string
          csrf_token: string
          id: string
          used: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          csrf_token: string
          id?: string
          used?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          csrf_token?: string
          id?: string
          used?: boolean
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      disconnect_xero_connection: {
        Args: { p_connection_id: string }
        Returns: Json
      }
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
      find_fuzzy_duplicate_entities: {
        Args: { _tenant_id: string; _threshold?: number }
        Returns: {
          entity_id_a: string
          entity_id_b: string
          name_a: string
          name_b: string
          similarity: number
          type_a: string
          type_b: string
        }[]
      }
      get_my_tenant_user: { Args: never; Returns: Json }
      get_user_tenant_id: { Args: { _user_id: string }; Returns: string }
      get_xero_connection_info: { Args: never; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_owner: { Args: { _tenant_id: string }; Returns: boolean }
      is_owner_or_admin: { Args: { _tenant_id: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      link_tenant_user_on_login: { Args: never; Returns: Json }
      rpc_change_tenant_user_role: {
        Args: {
          p_new_role: string
          p_tenant_id: string
          p_tenant_user_id: string
        }
        Returns: Json
      }
      rpc_create_tenant: {
        Args: { p_firm_name: string; p_name: string }
        Returns: Json
      }
      rpc_create_tenant_owner: {
        Args: { p_display_name?: string; p_email: string; p_tenant_id: string }
        Returns: Json
      }
      rpc_create_tenant_user_invite: {
        Args: {
          p_display_name?: string
          p_email: string
          p_role: string
          p_tenant_id: string
        }
        Returns: Json
      }
      rpc_disable_tenant_user: {
        Args: { p_tenant_id: string; p_tenant_user_id: string }
        Returns: Json
      }
      rpc_enable_tenant_user: {
        Args: { p_tenant_id: string; p_tenant_user_id: string }
        Returns: Json
      }
      rpc_list_all_tenants: { Args: never; Returns: Json }
      rpc_list_tenant_users_admin: {
        Args: { p_tenant_id: string }
        Returns: Json
      }
      rpc_reinvite_tenant_user: {
        Args: { p_tenant_id: string; p_tenant_user_id: string }
        Returns: Json
      }
      rpc_restore_tenant_user: {
        Args: { p_tenant_id: string; p_tenant_user_id: string }
        Returns: Json
      }
      rpc_soft_delete_tenant_user: {
        Args: { p_tenant_id: string; p_tenant_user_id: string }
        Returns: Json
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
      layout_mode: "auto" | "manual"
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
      layout_mode: ["auto", "manual"],
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
