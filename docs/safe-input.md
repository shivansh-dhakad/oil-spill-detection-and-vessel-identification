# Sentinel-1 SAFE input guide

## Accepted upload

Submit a Sentinel-1 SAFE product packaged as a ZIP archive, normally named like:

```text
S1A_IW_GRDH_... .SAFE.zip
```

The archive must retain its `.SAFE` product structure, including the manifest, annotation metadata, and measurement files. Do not upload an extracted measurement TIFF, a screenshot, or a repackaged archive with the SAFE directory removed.

## What the pipeline reads

During extraction, the ML service validates the SAFE layout and uses product metadata to obtain the acquisition time, footprint, and georeferencing. It locates the VV/VH measurement bands, calibrates their values, and constructs the model input.

## Upload size

SAFE archives are commonly hundreds of MB or larger. The default limit is `3072` MB in both the backend and ML service. If you change it, set the same `MAX_UPLOAD_MB` value in both `.env` files and ensure enough free disk space is available.

## Common input failures

| Message or symptom | Likely cause | Resolution |
|---|---|---|
| `Only Sentinel-1 .SAFE.zip archives are supported.` | The uploaded file is not a valid SAFE archive. | Upload the original SAFE ZIP product. |
| `No SAR measurement GeoTIFF files found` | The archive lacks measurement data. | Re-download or recreate the complete SAFE product. |
| Upload rejected as too large | Backend or ML limit is lower than the archive size. | Match and raise `MAX_UPLOAD_MB` in both services. |
| Extraction fails after upload | Archive structure or required SAFE metadata is missing. | Validate the archive and retain the original directory hierarchy. |

The internal SAFE measurement TIFFs are necessary for analysis. Standalone GeoTIFF files are intentionally not accepted.
