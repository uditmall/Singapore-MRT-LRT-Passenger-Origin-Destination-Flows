/* ===========================================================================
   OD dashboard - settings you are most likely to edit.
   Plain JavaScript: save the file and refresh the page.
   =========================================================================== */
window.OD_CONFIG = {

  title: "Singapore MRT & LRT origin-destination flows",
  bounds: [1.245, 103.60, 1.465, 104.02],   // south, west, north, east of the first view

  /* ---- Basemaps ----------------------------------------------------------
     osm : standard OpenStreetMap tiles (tile.openstreetmap.org), the default
     hot : Humanitarian OpenStreetMap Team style, hosted by OpenStreetMap France
     Neither needs a key. Both are free community services meant for light use.         */
  basemap: {
    default: "osm",
    providers: {
      osm:       { label: "OpenStreetMap standard", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                   attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' },
      hot:       { label: "OpenStreetMap Humanitarian", url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", subdomains: "abc",
                   attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors. Tiles style by <a href="https://www.hotosm.org/" target="_blank" rel="noopener">Humanitarian OpenStreetMap Team</a>, hosted by <a href="https://openstreetmap.fr/" target="_blank" rel="noopener">OpenStreetMap France</a>' },
      none:      { label: "No basemap", attribution: "" }
    }
  },

  /* ---- Credits (bottom strip and the "i" card) -------------------------- */
  credits: {
    dataset: "Passenger Volume by Origin Destination Train Stations",
    dataMallUrl: "https://datamall.lta.gov.sg",
    ltaLicenceUrl: "https://datamall.lta.gov.sg/content/datamall/en/SingaporeOpenDataLicence.html",
    ltaLicenceName: "Singapore Open Data Licence version 1.0",
    dataGovLicenceUrl: "https://data.gov.sg/open-data-licence",
    uraUrl: "https://data.gov.sg/datasets/d_222bfc84eb86c7c11994d02f8939da8d/view",   // Master Plan 2019 Rail Line layer
    author: "Udit Narayan Mall",
    gtfsName: "GTFS Schedule (Train)",
    gtfsAccessed: "2026-10-15",   // date the GTFS zip was downloaded, as YYYY-MM-DD; shown in the info box
    linkedin: "https://www.linkedin.com/in/udit-narayan-mall/"
  }
};

/* Builds the tile address for a basemap style. */
window.OD_CONFIG.tileUrl = function (key, z, x, y) {
  var p = this.basemap.providers[key];
  if (!p || !p.url) return "";
  var sd = p.subdomains || "a";
  return p.url.replace("{s}", sd[(x + y) % sd.length]).replace("{z}", z).replace("{x}", x).replace("{y}", y);
};
