# PhotoPrism Image Storage Design

## Goal

Store newly uploaded inspiration images in PhotoPrism instead of PostgreSQL. The app database should store only URL and metadata needed to render the card. Existing base64 image data does not need backward compatibility because it will be deleted and re-uploaded.

## Confirmed Decisions

- Use the app backend as a PhotoPrism upload proxy.
- Do not upload from the browser directly to PhotoPrism.
- Do not use a shared PhotoPrism import/originals folder.
- Do not migrate or preserve existing base64 image records.
- New card records should store PhotoPrism URLs, not image base64.
- Card thumbnails should use PhotoPrism thumbnail URLs.
- Zoomed image view should use a larger PhotoPrism image URL.

## Configuration

The backend reads PhotoPrism configuration from environment variables:

```env
PHOTOPRISM_INTERNAL_URL=http://host.docker.internal:2342
PHOTOPRISM_PUBLIC_URL=http://localhost:2342
PHOTOPRISM_USERNAME=admin
PHOTOPRISM_PASSWORD=<server-side-secret>
```

`PHOTOPRISM_INTERNAL_URL` is used by the Docker container to call PhotoPrism. `PHOTOPRISM_PUBLIC_URL` is stored in generated image URLs so the browser can render images from the user's Mac.

Secrets stay server-side and are never exposed in frontend code.

## Upload Flow

1. The user chooses, drops, or pastes an image.
2. The frontend compresses it as it does today and sends it to the app backend.
3. The backend logs in to PhotoPrism with server-side credentials.
4. The backend uploads the image to PhotoPrism.
5. The backend resolves the uploaded asset's PhotoPrism identifier and generated URLs.
6. The app saves a card record with URL metadata only.
7. AI keyword extraction can still use the temporary base64 payload from the upload request and update terms after the card is saved.

PhotoPrism upload failure should stop card creation and return a clear error. This avoids saving card rows with missing image URLs.

## Data Model

The `cards` table should move from base64 storage to URL storage:

```sql
ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS photo_uid TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
```

The existing `image_url` column remains, but new records use it as the large image URL instead of base64 data.

The frontend `ImageCard` model gains:

```ts
photoUid?: string;
thumbnailUrl?: string;
```

No old-data compatibility is required. Existing base64 records can be deleted and re-uploaded.

## Rendering

Small Polaroid cards render:

```ts
card.thumbnailUrl || card.imageUrl
```

The zoom modal renders:

```ts
card.imageUrl
```

This keeps the board lightweight while preserving a larger image when opened.

## Backend Boundaries

Add a focused PhotoPrism helper module for:

- Creating or reusing a PhotoPrism session.
- Uploading a base64 image as a file.
- Building public thumbnail and large image URLs from PhotoPrism response data.

The app's existing card CRUD routes remain responsible for saving and loading card metadata.

## Error Handling

- Missing PhotoPrism config returns a setup error.
- Login failure returns an authentication error without exposing the password.
- Upload failure returns a PhotoPrism upload error.
- URL resolution failure returns a storage metadata error.
- AI keyword extraction failure remains non-blocking after image storage succeeds.

## Verification

Implementation should be verified with:

- `npm run lint`
- `npm run build`
- Docker production restart on port `3005`
- Upload a pasted image and confirm PostgreSQL stores URL values, not base64.
- Confirm Polaroid cards use thumbnail URLs.
- Confirm zoom modal uses the large image URL.
