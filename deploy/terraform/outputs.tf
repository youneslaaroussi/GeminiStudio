# GeminiStudio Terraform Outputs

output "instance_name" {
  description = "Name of the created GCE instance"
  value       = google_compute_instance.gemini_studio.name
}

output "instance_external_ip" {
  description = "External IP address of the VM"
  value       = google_compute_address.gemini_studio.address
}

output "ssh_command" {
  description = "SSH command to connect to the VM"
  value       = "gcloud compute ssh ${google_compute_instance.gemini_studio.name} --zone=${var.zone} --project=${var.project_id}"
}

output "copy_env_command" {
  description = "Command to copy generated.env to the VM"
  value       = "gcloud compute scp ${path.module}/../generated.env ${google_compute_instance.gemini_studio.name}:/opt/gemini-studio/deploy/.env --zone=${var.zone} --project=${var.project_id}"
}

output "service_urls" {
  description = "URLs for each service"
  value = {
    langgraph_server      = "http://${google_compute_address.gemini_studio.address}:8080"
    asset_service         = "http://${google_compute_address.gemini_studio.address}:8081"
    video_effects_service = "http://${google_compute_address.gemini_studio.address}:8082"
    renderer              = "http://${google_compute_address.gemini_studio.address}:4000"
    billing_service       = "http://${google_compute_address.gemini_studio.address}:3100"
  }
}

output "frontend_env_vars" {
  description = "Environment variables to set in your frontend (Vercel, etc.)"
  value       = <<-EOT
    
    Add these to your frontend environment (Vercel Dashboard > Settings > Environment Variables):
    
    ASSET_SERVICE_URL=http://${google_compute_address.gemini_studio.address}:8081
    VIDEO_EFFECTS_SERVICE_URL=http://${google_compute_address.gemini_studio.address}:8082
    RENDERER_API_URL=http://${google_compute_address.gemini_studio.address}:4000
    NEXT_PUBLIC_LANGGRAPH_URL=http://${google_compute_address.gemini_studio.address}:8080
    NEXT_PUBLIC_BILLING_SERVICE_URL=http://${google_compute_address.gemini_studio.address}:3100
    
  EOT
}

output "gcs_bucket" {
  description = "GCS bucket name"
  value       = var.gcs_bucket_name
}

output "generated_env_file" {
  description = "Path to the generated .env file"
  value       = "${path.module}/../generated.env"
}

output "next_steps" {
  description = "Next steps after terraform apply"
  value       = <<-EOT
    
    Infrastructure created! Next steps:
    
    1. Copy the generated .env file to the VM:
       ${format("gcloud compute scp %s/../generated.env %s:/opt/gemini-studio/deploy/.env --zone=%s --project=%s", path.module, google_compute_instance.gemini_studio.name, var.zone, var.project_id)}
    
    2. Copy your service account JSON to the VM:
       gcloud compute scp /path/to/service-account.json ${google_compute_instance.gemini_studio.name}:/opt/gemini-studio/deploy/secrets/service-account.json --zone=${var.zone} --project=${var.project_id}
    
    3. Add GitHub secret for CI/CD:
       - Go to: https://github.com/<your-repo>/settings/secrets/actions
       - Create secret: GCP_SERVICE_ACCOUNT_KEY
       - Value: contents of your service account JSON file
    
    4. Push to main branch to trigger deployment:
       git push origin main
    
    5. Update your frontend environment with the values from 'terraform output frontend_env_vars'
    
  EOT
}
