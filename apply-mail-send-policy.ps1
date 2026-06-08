# apply-mail-send-policy.ps1
#
# Applies an Exchange Online Application Access Policy to restrict the
# "CLFN Housing App - Notifications" Entra service principal so it can
# only send mail from housing@clfn.on.ca (not tenant-wide).
#
# Prerequisites:
#   - Run in an elevated PowerShell 7+ session
#   - Exchange Admin or Global Admin account required
#   - GRAPH_CLIENT_ID: the Entra app's Application (client) ID
#       Find it in: Supabase Dashboard -> Edge Functions -> Secrets,
#       OR: Entra portal -> App Registrations -> "CLFN Housing App - Notifications"
#
# After running: policy propagates within ~1 hour. Sends continue
# working during propagation. Once active, any sendMail attempt from
# an address outside the scope group returns HTTP 403 from Graph.

# ── Prerequisites (run once, in an elevated session) ────────────────────────
# Install-Module -Name ExchangeOnlineManagement -Force -AllowClobber -Scope CurrentUser

# ── Connect ──────────────────────────────────────────────────────────────────
Connect-ExchangeOnline -UserPrincipalName "kevin.proctor@clfn.on.ca"

# ── Configuration ────────────────────────────────────────────────────────────
$appId        = "<YOUR_GRAPH_CLIENT_ID>"   # replace with value from Supabase secrets / Entra portal
$groupAlias   = "HousingNotificationsSenders"
$groupName    = "Housing Notifications Senders"
$sendMailbox  = "housing@clfn.on.ca"

# ── Step 1: Create a mail-enabled security group as the policy scope ─────────
# New-ApplicationAccessPolicy requires a group, not a mailbox directly.
Write-Host "Creating scope group..." -ForegroundColor Cyan
New-DistributionGroup `
  -Name        $groupName `
  -Alias       $groupAlias `
  -Type        Security `
  -Description "Scope group: restricts Housing App Notifications to $sendMailbox only"

# Wait for the group to provision before adding a member
Write-Host "Waiting 30s for group to provision..." -ForegroundColor Cyan
Start-Sleep -Seconds 30

Write-Host "Adding $sendMailbox to scope group..." -ForegroundColor Cyan
Add-DistributionGroupMember `
  -Identity $groupAlias `
  -Member   $sendMailbox

# Verify membership
Write-Host "`nGroup members:" -ForegroundColor Cyan
Get-DistributionGroupMember -Identity $groupAlias | Select-Object Name, PrimarySmtpAddress

# ── Step 2: Create the Application Access Policy ─────────────────────────────
Write-Host "`nCreating Application Access Policy..." -ForegroundColor Cyan
New-ApplicationAccessPolicy `
  -AppId              $appId `
  -PolicyScopeGroupId $groupAlias `
  -AccessRight        RestrictAccess `
  -Description        "Restrict CLFN Housing App Notifications to $sendMailbox only"

# ── Step 3: Verify the policy was created ────────────────────────────────────
Write-Host "`nActive policies for this app:" -ForegroundColor Cyan
Get-ApplicationAccessPolicy | Where-Object { $_.AppId -eq $appId }

# ── Step 4: Test ALLOW -- should return AccessCheckResult: Granted ───────────
Write-Host "`nTest ALLOW ($sendMailbox):" -ForegroundColor Green
Test-ApplicationAccessPolicy -AppId $appId -Identity $sendMailbox

# ── Step 5: Test BLOCK -- should return AccessCheckResult: Denied ────────────
Write-Host "`nTest BLOCK (kevin.proctor@clfn.on.ca):" -ForegroundColor Yellow
Test-ApplicationAccessPolicy -AppId $appId -Identity "kevin.proctor@clfn.on.ca"

Write-Host "`nDone. Policy propagates within ~1 hour." -ForegroundColor Green
Write-Host "To add a second sending mailbox later:" -ForegroundColor Gray
Write-Host "  Add-DistributionGroupMember -Identity '$groupAlias' -Member 'other@clfn.on.ca'" -ForegroundColor Gray

# ── Disconnect ────────────────────────────────────────────────────────────────
Disconnect-ExchangeOnline -Confirm:$false
