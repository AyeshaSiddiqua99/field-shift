"""One main growing region and season per country and crop, chosen by hand (approximate!).

(FAO country name, crop, latitude, longitude, sowing month, harvest month)
The harvest month's year is the year of the FAO yield record. If sowing > harvest the season starts the year before.
National yields are averages over a whole country, but we only have weather at ONE point per country: this is a known weakness
and is stated wherever the model is described.
"""
REGIONS = [
    # maize
    ("United States of America", "maize", 42.0, -93.6, 5, 10), ("Brazil", "maize", -24.5, -51.5, 10, 3), ("Argentina", "maize", -33.0, -62.0, 10, 3),
    ("Ukraine", "maize", 49.0, 32.0, 4, 10), ("France", "maize", 44.0, 0.5, 4, 10), ("Romania", "maize", 44.5, 26.0, 4, 10),
    ("Hungary", "maize", 47.0, 19.5, 4, 10), ("Italy", "maize", 45.2, 10.5, 4, 9), ("South Africa", "maize", -27.0, 27.0, 11, 5),
    ("China, mainland", "maize", 36.5, 115.0, 6, 10), ("Canada", "maize", 43.0, -81.0, 5, 10), ("Nigeria", "maize", 10.0, 8.0, 5, 10),
    ("Kenya", "maize", -0.4, 36.1, 3, 8), ("Zambia", "maize", -14.5, 28.0, 11, 5), ("Russian Federation", "maize", 45.5, 40.0, 5, 10),
    ("Serbia", "maize", 45.0, 20.0, 4, 10), ("Bulgaria", "maize", 43.5, 25.0, 4, 10),
    # wheat
    ("United States of America", "wheat", 38.5, -98.0, 10, 7), ("Canada", "wheat", 52.1, -106.7, 5, 9), ("Russian Federation", "wheat", 46.0, 41.0, 9, 7),
    ("Ukraine", "wheat", 49.0, 32.0, 10, 7), ("France", "wheat", 48.5, 2.5, 10, 7), ("Germany", "wheat", 51.5, 10.0, 10, 7),
    ("United Kingdom of Great Britain and Northern Ireland", "wheat", 52.0, -1.0, 10, 8), ("Poland", "wheat", 52.0, 19.0, 9, 8),
    ("Romania", "wheat", 44.5, 26.0, 10, 7), ("Spain", "wheat", 41.5, -4.5, 11, 7), ("Italy", "wheat", 43.0, 12.0, 11, 7),
    ("Türkiye", "wheat", 39.5, 33.0, 10, 7), ("India", "wheat", 30.9, 75.8, 11, 4), ("Pakistan", "wheat", 31.5, 73.0, 11, 4),
    ("China, mainland", "wheat", 35.0, 114.5, 10, 6), ("Australia", "wheat", -33.5, 147.0, 5, 12), ("Argentina", "wheat", -34.0, -62.0, 6, 12),
    ("Kazakhstan", "wheat", 51.5, 68.0, 5, 9), ("Morocco", "wheat", 33.5, -6.5, 11, 6),
    # soybean
    ("United States of America", "soybean", 41.0, -90.0, 5, 10), ("Brazil", "soybean", -13.0, -55.5, 10, 3), ("Argentina", "soybean", -33.0, -62.0, 11, 4),
    ("Paraguay", "soybean", -25.5, -55.5, 10, 3), ("China, mainland", "soybean", 47.0, 127.0, 5, 10), ("India", "soybean", 23.5, 77.5, 6, 10),
    ("Canada", "soybean", 43.0, -81.0, 5, 10), ("Ukraine", "soybean", 49.0, 30.0, 5, 10), ("Italy", "soybean", 45.2, 10.5, 4, 9),
    ("Bolivia (Plurinational State of)", "soybean", -17.0, -62.5, 11, 4), ("Uruguay", "soybean", -33.0, -57.5, 11, 5),
    ("Serbia", "soybean", 45.0, 20.0, 4, 9), ("Romania", "soybean", 44.5, 26.0, 4, 9), ("South Africa", "soybean", -26.5, 28.0, 11, 5),
    ("Nigeria", "soybean", 10.0, 8.0, 6, 10),
    # barley
    ("France", "barley", 48.5, 2.5, 10, 6), ("Germany", "barley", 51.5, 10.0, 10, 7), ("United Kingdom of Great Britain and Northern Ireland", "barley", 52.0, -1.0, 10, 8),
    ("Spain", "barley", 41.5, -4.5, 11, 6), ("Ukraine", "barley", 49.0, 32.0, 10, 7), ("Canada", "barley", 52.1, -106.7, 5, 9), ("Australia", "barley", -33.5, 147.0, 5, 12),
    ("Türkiye", "barley", 39.5, 33.0, 10, 7), ("Poland", "barley", 52.0, 19.0, 9, 8), ("Morocco", "barley", 33.5, -6.5, 11, 6), ("Argentina", "barley", -34.0, -62.0, 6, 12),
    ("Russian Federation", "barley", 46.0, 41.0, 9, 7), ("Denmark", "barley", 56.0, 10.0, 9, 8),
    # rice
    ("India", "rice", 26.5, 82.5, 6, 11), ("China, mainland", "rice", 30.5, 114.0, 5, 10), ("Bangladesh", "rice", 24.0, 90.0, 6, 11), ("Thailand", "rice", 15.0, 103.0, 6, 11),
    ("Pakistan", "rice", 31.0, 73.5, 6, 10), ("Philippines", "rice", 16.0, 121.0, 6, 11), ("United States of America", "rice", 34.5, -91.0, 4, 9), ("Brazil", "rice", -30.0, -53.0, 10, 3),
    ("Japan", "rice", 37.5, 139.0, 5, 9), ("Egypt", "rice", 31.0, 31.0, 5, 9), ("Italy", "rice", 45.2, 8.7, 4, 9), ("Myanmar", "rice", 17.0, 96.0, 6, 11), ("Viet Nam", "rice", 10.5, 105.5, 5, 9),
    # potato
    ("United States of America", "potato", 43.0, -112.0, 4, 9), ("Germany", "potato", 52.5, 10.0, 4, 9), ("France", "potato", 49.5, 2.5, 4, 9), ("Poland", "potato", 52.0, 19.0, 4, 9),
    ("United Kingdom of Great Britain and Northern Ireland", "potato", 52.5, 0.0, 4, 9), ("Netherlands (Kingdom of the)", "potato", 52.5, 5.5, 4, 9), ("Russian Federation", "potato", 53.0, 40.0, 5, 9),
    ("Ukraine", "potato", 50.0, 31.0, 4, 9), ("China, mainland", "potato", 41.0, 112.0, 4, 9), ("India", "potato", 26.5, 80.0, 10, 2), ("Canada", "potato", 46.5, -63.5, 5, 9),
    ("Belarus", "potato", 53.5, 28.0, 4, 9),
    # sorghum
    ("United States of America", "sorghum", 38.0, -98.0, 5, 10), ("Nigeria", "sorghum", 11.0, 8.0, 6, 10), ("Ethiopia", "sorghum", 10.0, 38.0, 6, 11), ("India", "sorghum", 18.5, 76.0, 6, 10),
    ("Mexico", "sorghum", 21.0, -100.5, 5, 10), ("Argentina", "sorghum", -32.0, -62.0, 11, 4), ("Australia", "sorghum", -27.0, 150.0, 10, 3), ("Niger", "sorghum", 13.0, 2.5, 6, 10),
    ("Burkina Faso", "sorghum", 12.0, -1.5, 6, 10), ("Sudan", "sorghum", 13.5, 33.0, 7, 11),
    # rapeseed (canola)
    ("Canada", "rapeseed", 52.1, -106.7, 5, 9), ("France", "rapeseed", 48.5, 2.5, 9, 7), ("Germany", "rapeseed", 51.5, 10.0, 8, 7), ("Poland", "rapeseed", 52.0, 19.0, 8, 7),
    ("United Kingdom of Great Britain and Northern Ireland", "rapeseed", 52.0, -1.0, 9, 7), ("Australia", "rapeseed", -33.5, 147.0, 5, 11), ("Ukraine", "rapeseed", 49.0, 32.0, 9, 7),
    ("China, mainland", "rapeseed", 30.5, 112.0, 10, 5), ("India", "rapeseed", 26.5, 76.0, 10, 3), ("Romania", "rapeseed", 44.5, 26.0, 9, 7), ("Russian Federation", "rapeseed", 46.0, 41.0, 9, 7),
]
HEAT = {"maize": 32.0, "wheat": 30.0, "soybean": 32.0, "barley": 30.0, "rice": 35.0, "potato": 30.0, "sorghum": 36.0, "rapeseed": 28.0}  # daily maximum temperature (C) above which a day counts as a heat day
