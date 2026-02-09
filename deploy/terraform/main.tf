# GeminiStudio - Single VM Deployment
# This Terraform configuration creates a GCE VM with Docker to run all backend services

terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

# Static external IP for the VM
resource "google_compute_address" "gemini_studio" {
  name   = "gemini-studio-ip"
  region = var.region
}

locals {
  cloudflare_ipv4 = [for cidr in var.cloudflare_ip_ranges : cidr if length(regexall(":", cidr)) == 0]
  cloudflare_ipv6 = [for cidr in var.cloudflare_ip_ranges : cidr if length(regexall(":", cidr)) > 0]
}

# Firewall rules - only allow Cloudflare ingress to the origin
resource "google_compute_firewall" "gemini_studio_cloudflare_ingress_ipv4" {
  count       = length(local.cloudflare_ipv4) > 0 ? 1 : 0
  name        = "gemini-studio-cloudflare-ipv4"
  network     = "default"
  direction   = "INGRESS"
  priority    = 800
  description = "Permit IPv4 HTTP/S traffic exclusively from Cloudflare edge networks."

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = local.cloudflare_ipv4
  target_tags   = ["gemini-studio"]
}

resource "google_compute_firewall" "gemini_studio_cloudflare_ingress_ipv6" {
  count       = length(local.cloudflare_ipv6) > 0 ? 1 : 0
  name        = "gemini-studio-cloudflare-ipv6"
  network     = "default"
  direction   = "INGRESS"
  priority    = 801
  description = "Permit IPv6 HTTP/S traffic exclusively from Cloudflare edge networks."

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = local.cloudflare_ipv6
  target_tags   = ["gemini-studio"]
}

resource "google_compute_firewall" "gemini_studio_deny_all_ipv4" {
  name        = "gemini-studio-deny-external-ipv4"
  network     = "default"
  direction   = "INGRESS"
  priority    = 900
  description = "Explicitly drop every other inbound IPv4 connection attempt to the origin."

  deny {
    protocol = "all"
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["gemini-studio"]
}

resource "google_compute_firewall" "gemini_studio_deny_all_ipv6" {
  name        = "gemini-studio-deny-external-ipv6"
  network     = "default"
  direction   = "INGRESS"
  priority    = 901
  description = "Explicitly drop every other inbound IPv6 connection attempt to the origin."

  deny {
    protocol = "all"
  }

  source_ranges = ["::/0"]
  target_tags   = ["gemini-studio"]
}

# Startup script to install Docker, clone repo, and configure environment
locals {
  startup_script = <<-EOF
    #!/bin/bash
    set -e

    # Install Docker
    apt-get update
    apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release git

    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

    # Enable and start Docker
    systemctl enable docker
    systemctl start docker

    # Add default user to docker group
    usermod -aG docker $(ls /home | head -1) || true

    # Create app directory structure
    mkdir -p /opt/gemini-studio/deploy/secrets
    chown -R 1000:1000 /opt/gemini-studio

    echo "Docker installation complete!"
    echo "Clone your repo to /opt/gemini-studio and run: docker compose up -d"
  EOF
}

# GCE VM Instance
# Environment variables are provided via deploy/.env and docker-compose - Terraform does not manage secrets.
resource "google_compute_instance" "gemini_studio" {
  name         = var.instance_name
  machine_type = var.machine_type
  zone         = var.zone

  tags = ["gemini-studio"]

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = var.disk_size_gb
      type  = "pd-balanced"
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.gemini_studio.address
    }
  }

  metadata = {
    startup-script = local.startup_script
  }

  # Allow stopping for updates
  allow_stopping_for_update = true

  # Service account with required permissions
  service_account {
    email  = var.service_account_email != "" ? var.service_account_email : null
    scopes = ["cloud-platform"]
  }

  labels = {
    app         = "gemini-studio"
    environment = "staging"
  }
}

# Optional: Cloud Storage bucket for assets (if not already exists)
resource "google_storage_bucket" "assets" {
  count = var.create_gcs_bucket ? 1 : 0

  name          = var.gcs_bucket_name
  location      = var.region
  force_destroy = true # Allow deletion even with objects

  uniform_bucket_level_access = true

  # CORS for direct GCS playback from app (signed URLs); avoids proxy lag in prod
  cors {
    origin          = ["https://www.geminivideo.studio", "https://geminivideo.studio", "http://localhost:3000"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type", "Content-Length", "Accept-Ranges", "Content-Range"]
    max_age_seconds = 3600
  }
}

# Pub/Sub topics - uses data sources if they exist, creates if they don't
# Import existing topics with: terraform import google_pubsub_topic.pipeline_events projects/PROJECT_ID/topics/gemini-pipeline-events

resource "google_pubsub_topic" "pipeline_events" {
  count   = var.create_pubsub_topics ? 1 : 0
  name    = "gemini-pipeline-events"
  project = var.project_id

  lifecycle {
    # If topic already exists, import it first or set create_pubsub_topics = false
    prevent_destroy = false
    # Ignore changes if topic was created outside Terraform
    ignore_changes = [labels]
  }
}

resource "google_pubsub_topic" "render_events" {
  count   = var.create_pubsub_topics ? 1 : 0
  name    = "gemini-render-events"
  project = var.project_id

  lifecycle {
    prevent_destroy = false
    ignore_changes  = [labels]
  }
}

resource "google_pubsub_topic" "veo_events" {
  count   = var.create_pubsub_topics ? 1 : 0
  name    = "gemini-veo-events"
  project = var.project_id

  lifecycle {
    prevent_destroy = false
    ignore_changes  = [labels]
  }
}
