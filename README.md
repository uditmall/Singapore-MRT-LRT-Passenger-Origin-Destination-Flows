# Singapore MRT & LRT origin-destination flows

Interactive dashboard of trips between MRT and LRT stations, from LTA DataMall (*Passenger Volume by Origin Destination Train Stations*). Months included: July to October 2026 (October opens first).
The code is MIT licensed; the data it shows is not. See [NOTICE](NOTICE) for the data licences (LTA, URA, OpenStreetMap).
Five views: **OD flow map**, **Passenger load between stations**, **Top corridors**, **Line to line**, **Weekday vs weekend**. Plain HTML, CSS and JavaScript, no build step and no API key.

## Publish on GitHub Pages
1. Create a public repository and upload everything in this folder (keep the folder structure; `index.html` must be at the top level).
2. Go to **Settings > Pages**, set **Source** to *Deploy from a branch*, choose branch `main` and folder `/ (root)`, and save.
3. After a minute the dashboard is live at `https://<your-username>.github.io/<repository-name>/`.

The map tiles load from the internet, so open the page from the Pages address (or any web server). Opening `index.html` straight from a folder may show a grey map, because OpenStreetMap blocks tile requests that carry no referrer. `od-dashboard.html` is the same dashboard as one file.

## Basemaps
Standard OpenStreetMap (default) and Humanitarian OpenStreetMap (hosted by OpenStreetMap France), plus a "No basemap" option. Neither needs a key. Both are free community tile servers meant for light use; if traffic grows, switch to a hosted tile service (edit `js/config.js`). Basemap opacity, rail line opacity and passenger load opacity can be changed in Settings. The scale bar at the bottom right of the credits ribbon follows the zoom level on the map views.

## Add a new month
1. Put the month's csv in `prepare/raw/` (named `pv_odtrain_YYYYMM.csv`). The csv files are not uploaded to GitHub (see `.gitignore`).
2. Add one entry to `prepare/months.json` (`month`, `csv`, `accessed` = the date you downloaded it).
3. Check `prepare/holidays.json` has that year's public holidays (add the observed Monday when a holiday is on a Sunday).
4. `cd prepare && python3 prepare_data.py` (needs pandas, numpy, openpyxl). Read the printed day counts and warnings.
5. Optional one-file copy: `python3 bundle_single_html.py`.
LTA sometimes spells a station two ways in one file (July 2026: Bayfront and Marina Bay). `CODE_ALIASES` in `prepare/od_model.py` merges them.

## Passenger load data (planned trains)
The load view needs LTA's *GTFS Schedule (Train)* feed. Unzip it into `prepare/gtfs/` (the folder is not uploaded to GitHub), then run `python3 prepare_load.py` from `prepare/`. It rewrites `data/od-load.js`. The feed used here was accessed on 15 October 2026.

## Method
Each trip is routed along the path with the fewest stops: 1 per stop plus a transfer penalty (default 4 stops, tested at 2 and 6). Tied routes share the trip equally. The line-to-line view counts each trip once, under the line of its first and its last leg. Trains are assumed to run both ways round the LRT loops.
For the load view, each trip is placed on the segments of its route in the hour it was recorded, then divided by the trains planned on that segment in that hour (GTFS; weekend trains blend Saturday and Sunday/public holiday by day counts). Passengers are conserved at every station. The full text is in the *Methodology* card of the load view.

## Credits and licences
- Contains information from *Passenger Volume by Origin Destination Train Stations*, from [LTA DataMall](https://datamall.lta.gov.sg), made available under the [Singapore Open Data Licence version 1.0](https://datamall.lta.gov.sg/content/datamall/en/SingaporeOpenDataLicence.html).
- Contains information from *GTFS Schedule (Train)*, from LTA DataMall, accessed on 15 October 2026, under the same licence.
- Rail lines were traced using the original [Master Plan 2019 Rail Line layer](https://data.gov.sg/datasets/d_222bfc84eb86c7c11994d02f8939da8d/view), Urban Redevelopment Authority, from data.gov.sg ([Singapore Open Data Licence](https://data.gov.sg/open-data-licence)).
- Basemap: &copy; [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors; Humanitarian style by the Humanitarian OpenStreetMap Team, hosted by OpenStreetMap France.
- Station locations were compiled by the author with the help of Claude AI. Lines and stations are indicative only.
- Independent student project, not affiliated with or endorsed by LTA.

The code is released under the [MIT licence](LICENSE). The licence covers the code only; the LTA, URA and OpenStreetMap data stay under their own licences.

Built by [Udit Narayan Mall](https://www.linkedin.com/in/udit-narayan-mall/), a Master's student in Rail and Urban Transport at TUM Asia. Spotted a mistake? Message me on [LinkedIn](https://www.linkedin.com/in/udit-narayan-mall/).
