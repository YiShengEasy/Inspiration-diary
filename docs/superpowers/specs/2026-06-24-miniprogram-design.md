# Inspiration Diary Mini Program Design

## Goal

Build a native WeChat mini program that carries the current Web app's full inspiration diary workflow while also offering useful image tools to visitors who have not logged in.

The mini program should feel like two connected products:

- A logged-in inspiration diary for saving images, Markdown notes, AI tags, summaries, original images, and weekly archives.
- A public toolbox for quick image editing, with a clear promotion path into the inspiration diary.

## Product Positioning

The first version uses a balanced dual-entry structure.

- Logged-out users land on the toolbox, where they can immediately edit images.
- Logged-in users land on the inspiration diary, where they can manage their weekly inspiration records.
- The toolbox and diary connect through "save to inspiration diary" after image processing.

## Navigation

Use three bottom tabs:

1. Inspiration Diary
2. Toolbox
3. Me

Default entry:

- Logged out: Toolbox
- Logged in: Inspiration Diary

## Inspiration Diary Tab

### Purpose

Provide the mini program version of the existing Web diary.

### Logged-In View

The main screen is the current week:

- Week switcher
- Search entry
- Settings entry only for app-level options, not AI model configuration
- Day groups: Monday, Tuesday, Wednesday, Thursday, Friday, Weekend
- Image and Markdown cards ordered newest first within each day
- Floating upload action for image, camera, and Markdown/text note

Card behavior:

- Outside card uses PhotoPrism thumbnail URL.
- Detail view uses original image URL.
- Markdown cards show name, summary, and tags.

### Logged-Out View

Do not show an empty blocked page.

Show:

- A lightweight preview of what the diary does
- Login CTA
- Benefits: weekly archive, AI tags, Markdown summaries, original image storage, download and sync

## Toolbox Tab

### Purpose

Provide useful image editing tools without login, while promoting the diary product.

### Visual Structure

Use the provided reference app as structural inspiration, adapted to Inspiration Diary branding.

Logged-out toolbox first screen:

- Top promotion banner for Inspiration Diary
- Primary actions: Import Image, Camera
- Quick entries: Crop, Pixel Style, Watermark
- Tool categories: Common, Style, AI, More
- Tool grid
- Recommended section for templates, recent styles, or example outputs

Logged-in toolbox:

- Promotion banner becomes smaller
- Show "processed images can be saved to Inspiration Diary"
- Keep all tool sections available

### First Version Tools

Public, no-login tools:

- Image crop
- Pixel style conversion
- Filter styles
- Watermark

Future extensions should use a tool configuration model instead of hard-coded homepage sections.

Each tool should define:

- id
- name
- icon
- category
- short description
- requiresLogin
- isLocalProcessing
- isExperimental
- sortWeight

This leaves room for future tools such as compression, collage, long image generation, certificate photo, AI expansion, or advanced AI styles.

### Tool Editing Page

Use a shared editor layout:

- Top bar: back, tool name, reset
- Center: image preview canvas
- Bottom: parameter panel and action buttons
- Completion actions: save to album, save to inspiration diary

## Me Tab

### Purpose

Account, storage, local state, and app information.

Do not expose AI provider settings in the mini program. The mini program calls the existing Web backend APIs, and AI model configuration remains managed on the Web side.

### Structure

Reference the provided "Me" screen structure, but simplify it for Inspiration Diary.

Content:

- Avatar, nickname, login status
- Stats: inspiration count, this week's records, tool usage
- Edit profile
- Banner:
  - Logged out: login to save inspiration diary
  - Logged in: sync and storage status
- Entry cards: drafts, local cache
- Sections: inspiration diary, tool works, favorites
- Privacy
- About and version
- Logout

## Visual Direction

Overall direction: warm inspiration diary plus native image-tool efficiency.

### Inspiration Diary

Keep the Web app's brand feeling:

- Warm paper-like background
- Simplified Polaroid and note-card feeling
- Small tag pills
- Gentle spacing
- Weekly diary structure

### Toolbox

Borrow from the reference:

- Strong top banner
- Clear large import/camera actions
- Tool cards and grid
- High scan speed
- Strong accent color

Use a bright green accent for toolbox actions if it fits the final brand, but avoid making the entire product look like a generic photo editor.

### Me

Use a clean white native mini-program style:

- Large avatar and nickname
- Sparse list rows
- Simple data blocks
- Minimal decoration

## Key Flows

### Flow 1: Logged-Out Tool Use

1. User opens the mini program.
2. App routes to Toolbox.
3. User sees Inspiration Diary promotion banner.
4. User taps Import Image or Camera.
5. User selects Crop, Pixel Style, Filter Style, or Watermark.
6. User edits the image.
7. User can save to album.
8. If user taps Save to Inspiration Diary, show login prompt.

### Flow 2: Save Tool Result to Inspiration Diary

1. User finishes editing an image.
2. User taps Save to Inspiration Diary.
3. If logged out, user logs in.
4. User selects date, defaulting to today.
5. User may add a short note.
6. Backend uploads original image to PhotoPrism.
7. Backend stores original image URL and PhotoPrism thumbnail URL in the database.
8. Backend generates AI tags.
9. Mini program navigates to the saved day card.

### Flow 3: Diary Upload

1. Logged-in user opens Inspiration Diary.
2. User taps upload action.
3. User chooses image, camera, or Markdown/text note.
4. Image upload uses PhotoPrism original storage and thumbnail URL.
5. Markdown upload calls the backend summary endpoint.
6. New content appears at the top of the selected day.

### Flow 4: Detail View

Image details:

- Load original image URL.
- Show original dimensions.
- Support zoom in, zoom out, 1:1 original size, and drag to inspect.
- Support save/download and delete.

Markdown details:

- Show Markdown preview.
- Show summary and tags.
- Support copy/download and delete.

### Flow 5: Archive Search

1. User enters archive/search from Inspiration Diary.
2. User filters by type, date, and tags.
3. Search covers AI image tags, Markdown summaries, and Markdown content.
4. Result cards open the same detail view.

## Backend Assumptions

Reuse existing backend APIs wherever possible:

- Authentication
- Card CRUD
- Notes
- Settings storage where relevant
- Image analysis
- Markdown summary
- PhotoPrism image proxy

The mini program does not configure AI providers or API keys.

## Implementation Boundaries

This document is a product and UI design spec only.

Implementation should be planned separately before creating mini program pages, components, API adapters, or image editing logic.
