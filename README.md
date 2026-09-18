# Group08 Database Connectivity Prototype

## Capstone Title
Bayanihan: Disaster Rescue — A 3D Flood Rescue Simulation Game for Disaster Preparedness
Awareness Among Youth Groups (SDG 11: Sustainable Cities and Communities)

## Prototype Feature
Saving and retrieving mission records. When a rescue mission ends, the game saves the run to
a Supabase database. The after-action screen then shows a Top runs leaderboard, and a
"Load from database" button reads the records back on demand.

## Group Members
1. Makheyl Chaild Dela Cruz
2. Member Name
3. Member Name
4. Member Name

## Description
The prototype is a 3D disaster rescue game set in a flooded barangay during a typhoon. The
player drives a rescue boat, finds eight residents stranded on their roofs, and brings them
to the evacuation center three at a time before the five-minute timer runs out. When the
mission ends, the game records the result in the database and displays the leaderboard so
players can compare their scores.

## Tools Used
- HTML, CSS and JavaScript
- Three.js r128 for the 3D rendering
- Supabase REST API for the database connection
- Visual Studio Code with the Live Server extension
- Git and GitHub
- Claude (Anthropic) for code assistance

## Database Used
Supabase (PostgreSQL 15), accessed through its REST API.

## Data Saved
- player_id (unique id of the player, generated on their device)
- player_name (callsign typed by the player)
- score
- level
- created_at (date and time of the run)
- residents_rescued
- residents_lost
- time_remaining
- completion_status
- remarks

## Project Files
```
index.html          page structure and all game screens
style.css           all styling for the HUD and menus
script.js           game logic and the database save and load functions
config.example.js   template for the database credentials
config.js           local credentials, ignored by git
.gitignore
README.md
db/schema.sql       table, constraints, indexes, security policies and views
docs/screenshots/   implementation evidence
```

## How to Run
1. In Supabase, open SQL Editor, paste the contents of `db/schema.sql`, and run it. This
   creates the table, the indexes, the security policies and the views.
2. Copy `config.example.js` to `config.js` and fill in your Supabase project URL and anon
   public key from Project Settings then API.
3. Open the folder in Visual Studio Code, install the Live Server extension, right click
   `index.html` and choose Open with Live Server. It opens at `http://127.0.0.1:5500`.
   You can also run `python -m http.server 5500` instead.
4. Do not open `index.html` by double clicking it. The browser treats it as a local file and
   blocks the database request.
5. If the chip on the title screen says "Supabase connected", the database is working. If it
   says "Local store", then `config.js` is missing or empty.

### Controls
| Key | Action |
|---|---|
| `W` | Throttle |
| `S` | Brake, then reverse |
| `A` `D` | Steer |
| `Shift` | Engine boost |
| `E` | Hold to bring a resident aboard |
| `Space` | Signal flare, lights every rooftop for six seconds |
| `P` | Pause |

## Database Flow
The game is made with HTML and JavaScript, so it talks to Supabase directly through the REST
API and does not need its own backend server.

**Saving.** The save is triggered when a mission ends, which happens when the timer runs out
or when no residents are left to rescue. The game collects the run data into one object and
sends it as a POST request to `/rest/v1/game_runs`. The anon public key is attached in the
request headers so Supabase knows which project it belongs to. If the save works, the
after-action report shows "Saved to Supabase". If the database cannot be reached, the run is
kept in browser storage instead so it is not lost.

**Retrieving.** After saving, the game sends a GET request to the `leaderboard` view, which
returns the best run of each player. Supabase sends the rows back as JSON and the game draws
them in the Top runs list on the after-action screen, with the player's own run highlighted.
The "Load from database" button runs the same request again so the records can be retrieved
on demand.

**Security.** The anon key is meant to be used in browser code, but it is still kept in
`config.js`, which is listed in `.gitignore` and is not committed. Row Level Security is what
protects the data. The policies allow adding a run and reading the board only. There is no
update or delete policy, so scores cannot be changed or erased through the public API. The
service_role key is never used in this project.

## Repository Access
The instructor GitHub account gracheleliza was added as collaborator.

## Known Limitations
- The prototype has only one map and one difficulty setting.
- There are no player accounts. A player is identified by a `player_id` stored in their
  browser, so clearing browser data or using another device creates a new id.
- Because there is no login, anyone can submit a run, and scores are not verified by a server.
- The leaderboard shows only the top eight runs and does not have paging or filters.
- The game must be served over http. Opening the file directly does not work.
- The prototype has been tested on desktop Chrome and Edge. Mobile has basic touch controls
  but has not been fully tested.
- Audio is not implemented yet.

## References
- Three.js documentation — https://threejs.org/docs/
- Supabase documentation — https://supabase.com/docs
- Supabase REST API (PostgREST) — https://postgrest.org/en/stable/
- PostgreSQL documentation — https://www.postgresql.org/docs/
- MDN Web Docs (Fetch API, Canvas, WebGL) — https://developer.mozilla.org/
- Claude (Anthropic) — used for code assistance and for writing the database schema
