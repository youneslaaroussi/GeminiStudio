# GeminiStudio Terraform Variables
# Secrets and env vars are managed via deploy/.env and docker-compose - Terraform only manages infrastructure.

# =============================================================================
# Required Variables
# =============================================================================

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "gcs_bucket_name" {
  description = "GCS bucket name for assets (must exist or set create_gcs_bucket=true)"
  type        = string
}

# =============================================================================
# Infrastructure Configuration
# =============================================================================

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP zone"
  type        = string
  default     = "us-central1-a"
}

variable "instance_name" {
  description = "Name of the GCE instance"
  type        = string
  default     = "gemini-studio"
}

variable "machine_type" {
  description = "GCE machine type"
  type        = string
  default     = "e2-standard-8"
}

variable "disk_size_gb" {
  description = "Boot disk size in GB"
  type        = number
  default     = 50
}

variable "service_account_email" {
  description = "Service account email (leave empty for default compute SA)"
  type        = string
  default     = ""
}

# =============================================================================
# Optional Resource Creation
# =============================================================================

variable "create_gcs_bucket" {
  description = "Create a new GCS bucket (set false if bucket already exists)"
  type        = bool
  default     = false
}

variable "create_pubsub_topics" {
  description = "Create Pub/Sub topics"
  type        = bool
  default     = true
}
