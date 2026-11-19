# Inventario Laboratorio 📦 (Laboratory Inventory)

🌐 **English** · [Español](README.md)

An open-source inventory manager for secondary-school laboratories in Uruguay and Latin America. Each school uses **its own Google Sheets spreadsheet** as the database, and the app adds search, a per-cabinet view with QR codes, photos, incident reports and a change history.

Public instance: <https://culturalibre.uy/inventariolab> · [Privacy policy](https://culturalibre.uy/inventariolab/privacidad) (Spanish)

> **⚠️ Language note:** the app's interface and its documentation in `docs/` are currently **in Spanish only**. This README is a short English overview so the project is easier to find and evaluate; the Spanish [README.md](README.md) is the complete reference (spreadsheet layout, environment variables, deployment, lessons learned).

## How it works

```
Browser ──► Cloudflare ──► nginx ──► Node.js/Express (PM2)
                                        │  in-memory cache (30 s)
                                        ▼
                       Google Sheets (each school's spreadsheet)
                       Google Drive  (photos, in an admin's Drive)
```

- Each laboratory is identified by **its spreadsheet ID**: `/inventariolab/lab/<ID>`.
- **Own laboratories (recommended):** a teacher taps "Crear mi laboratorio" (create my lab) or "Importar mi planilla" (import my spreadsheet), and the app creates the spreadsheet and the photo folder in **their** Google Drive using the narrow `drive.file` scope. "Exportar mis datos" downloads the spreadsheet as `.xlsx` and the photos as a ZIP, so teachers keep ownership of their data. Design notes: [`docs/laboratorios-propios.md`](docs/laboratorios-propios.md).
- **Service-account laboratories (earlier version, still working):** the school shares its spreadsheet with a Google service account as *Editor*.
- Users sign in with **Google OAuth** (name and email only).
- **Photo search** runs on the server itself, with no external services: it compares a photo against the items' photos using image embeddings (DINOv2-small, quantised, via `@huggingface/transformers`). It only recognises items that already have a photo.
- Writes go by a **fixed item ID**, not by row number, so rows can be sorted, inserted or deleted in the spreadsheet without a change landing on the wrong item. Every change from the app is logged in a `HISTORIAL` sheet.

### Roles

| Role | Search and view cabinets | Report incidents | Photos, move items, zones, QR |
|---|:-:|:-:|:-:|
| `ADMIN` | ✅ | ✅ | ✅ |
| `USER` or any other value | ✅ | ✅ | ❌ |
| `VISOR` (read-only) | ✅ | ❌ | ❌ |

Roles live in the spreadsheet's `config` sheet. Anyone not listed cannot sign in. With `acceso publico = SI`, anyone can view a cabinet by scanning its QR code, without signing in and without being able to search or report.

## Getting started

Requires Node.js 20 or later.

```bash
npm install
cp .env.example .env   # fill in the values
npm start              # or: npm run dev
npm test               # tests never call Google: a fake googleapis is used
```

A complete self-hosted installation (Google Cloud project, service account, OAuth client, redirect URIs) is described step by step in [`docs/instalacion-propia.md`](docs/instalacion-propia.md) (Spanish). Secrets never go into the repository: `.gitignore` excludes `.env`, service-account keys and `client_secret*.json`.

## Stack

Node.js · Express · EJS views · Google Sheets and Drive APIs · Google OAuth · installable PWA (Android and iOS) · PM2 behind nginx. The 1.x version (Google Apps Script) is kept in the repository as a reference only; the Node app does not use it.

## License

Free software under the **GNU General Public License, version 3 or later** (GPL-3.0-or-later). See [LICENSE](LICENSE). Bundled third-party libraries and data keep their own licenses.

## Support the project

If this is useful in your school or lab, you can support its maintenance on [GitHub Sponsors](https://github.com/sponsors/kterva). A ⭐ on the repository, a bug report, or telling another lab technician it exists also helps a lot.
