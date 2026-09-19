# Group08 Database Connectivity Prototype

## Capstone Title
Bayanihan: Disaster Rescue — A 3D Flood Rescue Simulation Game for Disaster Preparedness
Awareness Among Youth Groups (SDG 11: Sustainable Cities and Communities)

## Prototype Feature
Saving and retrieving mission records. When a rescue mission ends, the game saves the run to
a Supabase database — including what the player packed before launching and how the most
vulnerable residents fared. The after-action screen then shows a Top runs leaderboard, and a
"Load from database" button reads the records back on demand.

## Group Members
1. Christian Mchail Dela Cruz
2. Shiereen Francine Santos
3. Joaquin Andrei Singayan
4. John Benedict Villamor
5. Neil Andrew Velandrez

## Contributors
| GitHub | Name |
|---|---|
| [@makheyl](https://github.com/makheyl) | Christian Mchail Dela Cruz |
| [@nail-ambrew](https://github.com/nail-ambrew) | Neil Andrew Velandrez |

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
- packed (the supplies chosen in the preparation phase)
- stars (1 to 3 rating)
- high_saved and high_total (elderly, child and injured residents delivered, out of how many)

## Project Files
```
index.html          page structure and all game screens
style.css           all styling for the HUD and menus
script.js           game logic and the database save and load functions
.env.example        template for the database connection settings
.env                local connection settings, ignored by git
tools/env-to-config.sh  generates config.js from .env
config.example.js   template for writing config.js by hand instead
config.js           generated credentials file, ignored by git
.gitignore
README.md
db/schema.sql       table, constraints, indexes, security policies and views
db/sample_data.sql  optional demo rows, not run before the defense
docs/screenshots/   implementation evidence
```

## How to Run
1. In Supabase, open SQL Editor, paste the contents of `db/schema.sql`, and run it. This
   creates the table, the indexes, the security policies and the views. It does not add any
   rows, so the first run you play is the first row in the table. `db/sample_data.sql` can be
   run separately if you want a populated leaderboard while working on the layout.
2. Copy `.env.example` to `.env`, fill in your Supabase project URL and anon public key from
   Project Settings then API, and run `sh tools/env-to-config.sh`. That writes `config.js`,
   which is the file the page actually loads. Re-run it whenever `.env` changes.
   (`config.example.js` is still there if you would rather write `config.js` by hand.)
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
| `Shift` | Engine boost, drains the tank |
| `E` | Hold to bring a resident aboard |
| `1`–`4` | Use the matching packed supply |
| `Space` | Signal flare, lights every rooftop for six seconds |
| `P` | Pause |

## Game Mechanics
The point of the game is that **rescue is a community act and preparation is what makes it
possible**, so the mission is built to make an empty slot in the boat cost somebody.

**Preparation phase.** Before launching, the player packs the bangka. There are eight supplies
and only four slots, so packing is a real decision. Nothing is ever blocked — the player is
free to launch badly prepared, and the report afterwards names what that cost.

| Supply | What it does in the water |
|---|---|
| Salbabida (lifebuoy) | Required to take anyone already in open water |
| Botika (first-aid kit) | Required to treat an injured resident, as a two-second hold, before they can board |
| Lubid (rope) | Required to free anyone pinned behind debris |
| Flashlight | Roughly triples the range at which a signal light is spotted |
| Radyo (two-way radio) | Calls in a bearing to someone not yet located, every 20 seconds |
| Tubig (drinking water) | Three swigs, each refilling the engine boost instantly |
| Kapote (raincoat) | Residents hold on longer across the whole roster |
| Relief goods | +30 points per resident delivered, but saves nobody |

**Triage.** Every resident is tagged elderly, child, injured or able-bodied. Higher priority is
worth more points *and* runs out sooner, which is the triage lesson expressed as two numbers:
you cannot reach everyone, so you learn who to reach first. The report scores high-priority
survivors separately from the headline count.

**Situations.** Residents are not all simply waiting on a roof. Some are already in the current
and some are pinned against debris, and each of those needs the matching tool. A resident whose
personal timer runs out does not die — they slip off the roof into the water, where they are
still savable but only with the salbabida and only briefly.

**The flood is the clock.** The waterline climbs for the whole mission. When it reaches a roof,
whoever is standing on it is lost, and the low houses go under first. Reading the water and
going to the low roofs early is the skill the mission is teaching.

**The report.** The after-action screen does not just score the run. It writes the link between
the pack and the outcome in plain language — *"No salbabida. You pulled alongside two residents
in open water and had nothing to throw them."*

## Database Flow
The game is made with HTML and JavaScript, so it talks to Supabase directly through the REST
API and does not need its own backend server.

**Saving.** The save is triggered when a mission ends, which happens when the timer runs out
or when no residents are left to rescue. The game collects the run data into one object and
sends it as a POST request to `/rest/v1/game_runs`. The anon public key is attached in the
request headers so Supabase knows which project it belongs to. If the save works, the
after-action report shows "Saved to Supabase". If the database cannot be reached, the run is
kept in browser storage instead so it is not lost, and it is also added to a retry queue. The
next time the game loads and reaches Supabase, the queued runs are posted and the queue is
cleared, so a run played during an outage still ends up in the database. Every request is
given an eight second deadline so a stalled connection falls back to browser storage rather
than leaving the report waiting.

**Analysing.** The `preparation_effect` view groups every run by whether the three rescue tools
were aboard and compares the outcomes — average rescued, average lost, and the percentage of
high-priority residents saved. That view is how the project's claim is actually argued from the
data rather than asserted: if the game teaches what it says it does, the well-packed rows save
more of the people who could least afford to wait.

**Retrieving.** After saving, the game sends a GET request to the `leaderboard` view, which
returns the best run of each player. Supabase sends the rows back as JSON and the game draws
them in the Top runs list on the after-action screen, with the player's own run highlighted.
The "Load from database" button runs the same request again so the records can be retrieved
on demand.

**Security.** The connection settings live in `.env`, which is listed in `.gitignore` and is
not committed, and `tools/env-to-config.sh` turns them into the `config.js` the page loads.
`config.js` is gitignored too. It is worth being clear about what that does and does not buy:
because this is a browser game with no server of its own, the anon key is shipped to every
player and anyone can read it with View Source. Keeping it out of the repository stops it
being published on GitHub; it does not make it secret. The generator refuses outright if it is
handed a `service_role` key, since that one bypasses Row Level Security and must never reach a
browser. Row Level Security is what
protects the data. The policies allow adding a run and reading the board only. There is no
update or delete policy, so scores cannot be changed or erased through the public API. The
service_role key is never used in this project.

## Repository Access
The instructor GitHub account gracheleliza was added as collaborator.

## Known Limitations
- The prototype has only one map and one difficulty setting. The supply set and the triage
  rules are built to support more missions, but only the one barangay is implemented.
- The preparation phase offers eight supplies against four slots. The kapote and the relief
  goods are the weakest of the eight by design, but they have not been balance-tested against
  a large number of real playthroughs.
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
