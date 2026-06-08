# geocode-units.ps1
#
# Geocodes housing_units rows that have no latitude/longitude set.
# Uses OpenStreetMap Nominatim - no API key, no Google, OCAP-compliant.
#
# Prerequisites:
#   - PowerShell 5.1+ or PowerShell 7+
#   - Supabase SERVICE ROLE KEY (not the anon key)
#       Find it: Supabase Dashboard -> Project Settings -> API -> service_role secret
#
# Usage:
#   .\geocode-units.ps1 -ServiceRoleKey "eyJ..."
#   (Script will prompt interactively if -ServiceRoleKey is omitted)
#
# Notes:
#   - Nominatim rate limit is 1 request/second - the script enforces this.
#   - Reserve addresses may not all be in OSM. Unmatched units are listed at
#     the end so you can set their coordinates manually in Supabase.
#   - Always verify pins on the map after running - geocoding is approximate.

param(
    [string]$ServiceRoleKey = ''
)

# -- Configuration -------------------------------------------------------------
$SUPABASE_URL     = 'https://fkhzrbalumzeripzolph.supabase.co'
$SERVICE_ROLE_KEY = $ServiceRoleKey
$COMMUNITY        = 'Constance Lake First Nation'
$PROVINCE         = 'Ontario'
$COUNTRY          = 'Canada'
$NOMINATIM_UA     = 'CLFN-Housing-App-Geocoder/1.0 (kevin.proctor@clfn.on.ca)'

# -- Prompt for key if not set -------------------------------------------------
if (-not $SERVICE_ROLE_KEY) {
    $SERVICE_ROLE_KEY = Read-Host 'Enter Supabase service role key'
}

$headers = @{
    'apikey'        = $SERVICE_ROLE_KEY
    'Authorization' = "Bearer $SERVICE_ROLE_KEY"
    'Content-Type'  = 'application/json'
    'Prefer'        = 'return=minimal'
}

# -- Fetch units with no coordinates -------------------------------------------
Write-Host "`nFetching units with no coordinates..." -ForegroundColor Cyan

$query    = '/rest/v1/housing_units?select=id,num,street&latitude=is.null&limit=1000'
$response = Invoke-RestMethod -Uri ($SUPABASE_URL + $query) -Headers $headers -Method Get
$units    = $response

if (!$units -or $units.Count -eq 0) {
    Write-Host 'All units already have coordinates. Nothing to do.' -ForegroundColor Green
    exit 0
}

Write-Host "Found $($units.Count) unit(s) to geocode.`n" -ForegroundColor Yellow

# -- Geocode each unit ---------------------------------------------------------
$succeeded = @()
$failed    = @()

foreach ($unit in $units) {
    $num    = ($unit.num    -as [string]).Trim()
    $street = ($unit.street -as [string]).Trim()

    if (-not $num -and -not $street) {
        Write-Host "  SKIP  id=$($unit.id) - no address on record" -ForegroundColor DarkGray
        $failed += [PSCustomObject]@{ id=$unit.id; address='(no address)'; reason='Missing num+street' }
        continue
    }

    $address = "$num $street".Trim()
    Write-Host "  Geocoding: $address" -ForegroundColor Gray

    # Structured Nominatim query - more reliable than a freetext search
    $nmParams = [System.Web.HttpUtility]::ParseQueryString('')
    $nmParams['street']        = $address
    $nmParams['city']          = $COMMUNITY
    $nmParams['state']         = $PROVINCE
    $nmParams['country']       = $COUNTRY
    $nmParams['format']        = 'json'
    $nmParams['limit']         = '1'
    $nmParams['addressdetails'] = '0'
    $nmUri = 'https://nominatim.openstreetmap.org/search?' + $nmParams.ToString()

    try {
        $geo = Invoke-RestMethod -Uri $nmUri `
            -Headers @{ 'User-Agent' = $NOMINATIM_UA } `
            -Method Get

        if ($geo -and $geo.Count -gt 0) {
            $lat = [double]$geo[0].lat
            $lng = [double]$geo[0].lon

            # Patch the unit row in Supabase
            $body     = @{ latitude = $lat; longitude = $lng } | ConvertTo-Json
            $patchUri = $SUPABASE_URL + '/rest/v1/housing_units?id=eq.' + [Uri]::EscapeDataString($unit.id)
            Invoke-RestMethod -Uri $patchUri -Headers $headers -Method Patch -Body $body | Out-Null

            Write-Host "    OK  $address -> $($lat.ToString('F5'))N / $([Math]::Abs($lng).ToString('F5'))W" -ForegroundColor Green
            $succeeded += [PSCustomObject]@{ id=$unit.id; address=$address; lat=$lat; lng=$lng }
        } else {
            Write-Host "    NO RESULT for: $address" -ForegroundColor Yellow
            $failed += [PSCustomObject]@{ id=$unit.id; address=$address; reason='No Nominatim result' }
        }
    } catch {
        Write-Host "    ERROR: $_" -ForegroundColor Red
        $failed += [PSCustomObject]@{ id=$unit.id; address=$address; reason=$_.ToString() }
    }

    # Respect Nominatim's 1 req/sec rate limit
    Start-Sleep -Milliseconds 1100
}

# -- Summary -------------------------------------------------------------------
Write-Host "`n-- Summary ----------------------------------------------------------" -ForegroundColor Cyan
Write-Host "  Geocoded:  $($succeeded.Count)" -ForegroundColor Green
Write-Host "  Failed:    $($failed.Count)"    -ForegroundColor $(if ($failed.Count -gt 0) { 'Yellow' } else { 'Green' })

if ($failed.Count -gt 0) {
    Write-Host "`n  Units needing manual coordinates:" -ForegroundColor Yellow
    $failed | ForEach-Object {
        Write-Host "    id=$($_.id)  address='$($_.address)'  reason=$($_.reason)" -ForegroundColor DarkYellow
    }
    Write-Host "`n  Set them in Supabase:" -ForegroundColor Gray
    Write-Host "    Table: housing_units  |  Columns: latitude, longitude" -ForegroundColor Gray
    Write-Host "    Tip: use https://www.openstreetmap.org to find coordinates by clicking the map." -ForegroundColor Gray
}

Write-Host "`nDone. Verify pins in the app before relying on them for anything important." -ForegroundColor Cyan
