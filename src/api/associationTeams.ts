import type {
  AssociationPayable,
  AssociationPayableRelatedEntityType,
  AssociationPayableStatus,
  AssociationPaymentCollectionMode,
  AssociationPaymentCompletionStatus,
  AssociationPaymentMethodType,
  AssociationPaymentOrder,
  AssociationPaymentOrderStatus,
  AssociationPaymentTransaction,
  AssociationTeam,
  AssociationTeamStatus,
  Paginated,
  TeamLifecycleActionType,
  TeamLifecycleEntry
} from '../types'

import { fetchSportType } from './sportTypes'
import { fetchAgeGroups } from './ageRatingCatalogue'
import { fetchRatings } from './associationRatings'

/** Resolve an age-group label from the cached catalogue by id (mock join). */
async function ageGroupName(id: string): Promise<string> {
  return (await fetchAgeGroups()).find((a) => a.id === id)?.name ?? ''
}
/** Resolve a rating label from the association's cached ratings by id. */
async function ratingName(associationShortName: string, id: string): Promise<string> {
  return (await fetchRatings({ associationShortName })).find((r) => r.id === id)?.name ?? ''
}

/** Convert the form's user-input `last_update_date` (`YYYY-MM-DD`) to an ISO
 *  timestamp for the mock's `lastUpdatedAt`; falls back to now when blank. */
function lastUpdatedIso(dateOnly?: string): string {
  if (dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    return new Date(`${dateOnly}T00:00:00.000Z`).toISOString()
  }
  return new Date().toISOString()
}

/** Slice an in-memory array into a `Paginated<T>` page (mock helper). */
function paginate<T>(rows: T[], page = 1, perPage = 25): Paginated<T> {
  const safePage = Math.max(1, Math.floor(page))
  const start = (safePage - 1) * perPage
  const slice = rows.slice(start, start + perPage)
  return {
    data: slice,
    currentPage: safePage,
    perPage,
    total: rows.length,
    hasMore: start + slice.length < rows.length
  }
}

/**
 * Frontend-only mock layer for the Association Teams listing. v1
 * generates 1,710 teams deterministically from name / city / rating
 * pools so reloads show the same data and continuous-scroll has
 * enough volume to feel realistic.
 *
 * When the real backend lands, swap each function body for a fetch /
 * post call and keep the same signatures — the view doesn't need to
 * know it's mocked.
 */

const SIMULATED_LATENCY_MS = 320

function delay<T>(value: T, ms = SIMULATED_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

// Pool of fictional team names — drawn from softball-flavoured words
// so the list reads as believable association data without using any
// real team names. Walked deterministically by index so reloads are
// stable.
const TEAM_NAME_POOL = [
  '1 Bat', '1st Draft', '1st State 50s', '3 Up 3 Down', '303 Squad',
  '4 Aces', '4 Brothers', '50 Cal', '5 Tool Players', '60 Plus Allstars',
  'Aces Wild', 'Action Jackson', 'Adrenaline Rush', 'Alabama Heat',
  'Albany Aces', 'All In', 'All Stars', 'Almost Famous', 'Aluminum Avengers',
  'American Pride', 'American Steel', 'Anchors Aweigh', 'Apex Predators',
  'Arizona Outlaws', 'Arkansas Travelers', 'Atlantic Coast Sluggers',
  'Bandits', 'Bandit Brothers', 'Bartholomew Boys', 'Battery Pack',
  'Battling Birds', 'Bay Area Bulldogs', 'Bayou Boys', 'Beach Boys',
  'Beach Bums', 'Beasts of the East', 'Big Country', 'Big Hitters',
  'Big Sticks', 'Black Diamond', 'Black Knights', 'Blackjacks',
  'Bloomington Bombers', 'Blue Crew', 'Blue Devils', 'Blue Jays',
  'Bluegrass Boys', 'Bombers', 'Boomerangs', 'Boomers', 'Boston Bulldogs',
  'Boys of Summer', 'Brewers', 'Brick House', 'Bridgeport Bombers',
  'Brigade', 'Bronx Bombers', 'Bronze Stars', 'Brooks Brothers',
  'Brothers in Arms', 'Buccaneers', 'Buckaroos', 'Buckeye Boys',
  'Bulldogs', 'Bull Sharks', 'Burning Embers', 'Burton Boys', 'Cactus Crew',
  'Cajun Country', 'California Classic', 'Cape Crushers', 'Capital City',
  'Captains', 'Cardinals', 'Carolina Coastal', 'Carolina Crushers',
  'Cascade Climbers', 'Castaways', 'Cataracts', 'Cavaliers', 'Cellar Dwellers',
  'Centennial Squad', 'Central Valley', 'Champions', 'Charlotte Hornets',
  'Cherokee Warriors', 'Chesapeake Bay', 'Chicago Crusaders', 'Chiefs',
  'Choppers', 'Cincinnati Slingers', 'Citadel Squad', 'Classic Slowpitch',
  'Clippers', 'Coast Guard', 'Coastal Carolina', 'Cobras', 'Colonial',
  'Colorado Cowboys', 'Comets', 'Connecticut Crew', 'Continental',
  'Coyotes', 'Cracker Jacks', 'Crescent City', 'Crusaders', 'Crushers',
  'Cyclones', 'Dakota Dynasty', 'Daring Dynamos', 'Dauntless', 'Deacons',
  'Deep Sixers', 'Defenders', 'Delaware Diamonds', 'Demolition Crew',
  'Denver Diamonds', 'Desert Dawgs', 'Desert Hawks', 'Detroit Diesel',
  'Diamond Boys', 'Diamond Cutters', 'Diamond Dawgs', 'Diamond Dukes',
  'Diamond Kings', 'Diamond Sharks', 'District Defenders', 'Dixie Crew',
  'Dixie Diamonds', 'Dodgers', 'Dominators', 'Dragons', 'Dream Team',
  'Drillers', 'Dukes', 'Dust Devils', 'Dynamo', 'Eagle Eyes', 'Eagles',
  'East Coast Aces', 'Eastern Eagles', 'Edgewater Express', 'El Paso Thunder',
  'Elders', 'Elite', 'Empire State', 'Endgame', 'Enforcers', 'Express',
  'Fighting Irish', 'Final Score', 'Firebirds', 'Five Star', 'Flagship',
  'Flatlanders', 'Florida Force', 'Force', 'Founders', 'Foxes', 'Frontier',
  'Galaxy', 'Garden State', 'Gators', 'Gentlemen', 'Generals', 'Geriatric Giants',
  'Ghosts', 'Giants', 'Gladiators', 'Glory Days', 'Goldrush', 'Gophers',
  'Gorillas', 'Grand Slam', 'Granite State', 'Grasshoppers', 'Gray Wolves',
  'Greatest Generation', 'Green Mountain', 'Greybeards', 'Grizzlies',
  'Guardians', 'Gulf Coast', 'Gunslingers', 'Hammers', 'Harvest Time',
  'Hawks', 'Heartlanders', 'Heat', 'Heavy Hitters', 'Heritage', 'Hickory',
  'Hideaway Heroes', 'Hill Country', 'Hilltoppers', 'Hitters', 'Hogs',
  'Hometown Heroes', 'Honey Badgers', 'Hoosiers', 'Hornets', 'Horseshoes',
  'Hounds', 'Houston Heat', 'Hurricanes', 'Husky Nation', 'Idaho Spuds',
  'Illinois Express', 'Indians', 'Indiana Hoosiers', 'Inferno', 'Iron Eagles',
  'Iron Horses', 'Iron Mike', 'Ironclads', 'Iroquois', 'Islanders', 'Jacks',
  'Jackals', 'Jersey Boys', 'Jersey Devils', 'Just for Fun', 'Kansas Klassics',
  'Keepers', 'Kentucky Knights', 'Kings', 'Knights', 'Kodiak Bears',
  'Lake Effect', 'Lakers', 'Land Sharks', 'Lariats', 'Last Call', 'Last Stand',
  'Late Bloomers', 'Legacy', 'Legends', 'Liberty Bell', 'Liberty Boys',
  'Lifers', 'Lightning', 'Lions', 'Lone Star', 'Long Ball', 'Long Branch',
  'Longshots', 'Looney Tuners', 'Lords', 'Lost Boys', 'Loud Mouths',
  'Lumberjacks', 'Mad Dogs', 'Mad Hatters', 'Mainliners', 'Major League',
  'Mallards', 'Mariners', 'Marines', 'Marshals', 'Maryland Mountaineers',
  'Massachusetts Marauders', 'Mavericks', 'Mayflowers', 'Memphis Mash',
  'Metro Crew', 'Michigan Mash', 'Mid-Atlantic Mavericks', 'Midwest Mash',
  'Minnesota Maulers', 'Minutemen', 'Mississippi Mud', 'Missouri Mules',
  'Montana Mountaineers', 'Moose', 'Motor City', 'Mountaineers',
  'Music City Mash', 'Mustangs', 'Nashville Knights', 'Native Sons',
  'Naturals', 'Nebraska Cornhuskers', 'Nevada Knights', 'New Englanders',
  'New Hampshire Hawks', 'New Jersey Jaguars', 'New Mexico Mountaineers',
  'New York Knights', 'No Limit', 'No Mercy', 'Nor Easters', 'North Star',
  'Northern Lights', 'Nostalgia', 'Oak Ridge Boys', 'Oakland Aces',
  'Oilers', 'Oklahoma Sooners', 'Old Dominion', 'Old Glory', 'Old Guard',
  'Old School', 'Old Stogies', 'Old Timers', 'Olde England', 'Omaha Outlaws',
  'On Deck', 'Orange Crush', 'Oregon Outlaws', 'Original Recipe', 'Orioles',
  'Outlaws', 'Outsiders', 'Over the Hill', 'Owls', 'Pacific Northwest',
  'Pacific Rim', 'Padres', 'Palmettos', 'Panhandle Panthers', 'Panthers',
  'Paragons', 'Patriots', 'Peach State', 'Pelicans', 'Penguins', 'Penn State',
  'Perfect Game', 'Phantoms', 'Phoenix Phantoms', 'Pioneers', 'Pirates',
  'Pittsburgh Power', 'Plainsmen', 'Players', 'Plum Crazy', 'Polar Bears',
  'Power Hitters', 'Prairie Dogs', 'Prime Time', 'Privateers', 'Pro Edge',
  'Pythons', 'Quakers', 'Quicksilver', 'Rage', 'Raiders', 'Rainmakers',
  'Rangers', 'Rapids', 'Rattlers', 'Rebel Yell', 'Rebels', 'Red Stick',
  'Redwoods', 'Renegades', 'Republic', 'Revival', 'Riders', 'Riff Raff',
  'River Bandits', 'Riverboat Gamblers', 'Riverhawks', 'Roadrunners',
  'Rockies', 'Rocket Boys', 'Rollers', 'Rough Riders', 'Round Rock Rollers',
  'Royals', 'Sabretooths', 'Saguaros', 'Sailors', 'Saints', 'Salmon Slammers',
  'San Jose Surge', 'Sand Crabs', 'Sandstorm', 'Sasquatch', 'Savages',
  'Scorpions', 'Sea Dogs', 'Seasoned Pros', 'Seattle Slingers', 'Senators',
  'Senior Slammers', 'Sentinels', 'Settlers', 'Shadows', 'Sharks', 'Sherpa',
  'Shooters', 'Shore Birds', 'Show Boats', 'Showtime', 'Silver Bullets',
  'Silver Eagles', 'Silver Foxes', 'Silver Slammers', 'Silver Streaks',
  'Six Shooters', 'Sky High', 'Slam Dunks', 'Slammers', 'Slingers',
  'Slow Pokes', 'Slugs', 'Sluggers', 'Smokin Hot', 'Snake Eyes', 'Sneakers',
  'Sons of Pitches', 'Sons of Thunder', 'Sooner Slammers', 'South Sliders',
  'Southerners', 'Southland Sluggers', 'Sox Appeal', 'Spartans', 'Spirits',
  'Springs', 'Squires', 'Stallions', 'Stampede', 'Stand Tall', 'Stars',
  'Stars and Stripes', 'Statesmen', 'Steadfast', 'Steamboat', 'Steel City',
  'Steel Curtain', 'Stingers', 'Stoneham', 'Strangers', 'Sunbelt Slammers',
  'Sundowners', 'Sunshine Slammers', 'Surge', 'Survivors', 'Swatters',
  'Swingers', 'Tampa Trouble', 'Tars', 'Tar Heels', 'Tarheels', 'Tarpons',
  'Team America', 'Team Effort', 'Team Texas', 'Tenacious', 'Tennessee Titans',
  'Texas Tornadoes', 'Thoroughbreds', 'Thrashers', 'Three Stooges',
  'Thunder', 'Thunderbirds', 'Tigers', 'Timberwolves', 'Titans', 'Tomahawks',
  'Top Dogs', 'Top Guns', 'Tornadoes', 'Towers', 'Trailblazers', 'Travelers',
  'Tribe', 'Tridents', 'Trojans', 'Tropics', 'Troublemakers', 'Tundra',
  'Twin Cities', 'Underdogs', 'United', 'Untouchables', 'Urban Legends',
  'Utah Jazz', 'Valley Boys', 'Vandals', 'Vanguards', 'Vermont Verge',
  'Veterans', 'Vintage', 'Vipers', 'Virginians', 'Voyagers', 'Wahoos',
  'Walking Wounded', 'War Eagles', 'War Hawks', 'Warriors', 'Washington Wolves',
  'Watermen', 'Wave Riders', 'Waves', 'West Coast Crushers', 'Western Stars',
  'Whalers', 'Whitecaps', 'Wildcats', 'Wild Things', 'Wildcards', 'Winchester',
  'Wisconsin Wonders', 'Wizards', 'Wolfpack', 'Wolverines', 'Wolves',
  'Wood Choppers', 'Wranglers', 'Wyoming Wranglers', 'X-Treme', 'Yankees',
  'Yeoman', 'Young Guns', 'Zealots', 'Zenith'
]

const CITY_STATE_POOL: Array<[string, string]> = [
  ['Albany', 'NY'], ['Albuquerque', 'NM'], ['Allentown', 'PA'], ['Amarillo', 'TX'],
  ['Anchorage', 'AK'], ['Annapolis', 'MD'], ['Arlington', 'TX'], ['Asheville', 'NC'],
  ['Athens', 'GA'], ['Atlanta', 'GA'], ['Augusta', 'GA'], ['Austin', 'TX'],
  ['Baltimore', 'MD'], ['Baton Rouge', 'LA'], ['Beaumont', 'TX'], ['Bellingham', 'WA'],
  ['Berkeley', 'CA'], ['Billings', 'MT'], ['Birmingham', 'AL'], ['Bismarck', 'ND'],
  ['Boise', 'ID'], ['Boston', 'MA'], ['Boulder', 'CO'], ['Bowling Green', 'KY'],
  ['Bozeman', 'MT'], ['Bradenton', 'FL'], ['Brandon', 'FL'], ['Bridgeport', 'CT'],
  ['Brockton', 'MA'], ['Brookings', 'SD'], ['Buffalo', 'NY'], ['Burlington', 'VT'],
  ['Cape Coral', 'FL'], ['Carson City', 'NV'], ['Cary', 'NC'], ['Casper', 'WY'],
  ['Cedar Rapids', 'IA'], ['Charleston', 'SC'], ['Charlotte', 'NC'], ['Chattanooga', 'TN'],
  ['Chesapeake', 'VA'], ['Cheyenne', 'WY'], ['Chicago', 'IL'], ['Cincinnati', 'OH'],
  ['Clarksville', 'TN'], ['Clearwater', 'FL'], ['Cleveland', 'OH'], ['Colorado Springs', 'CO'],
  ['Columbia', 'MO'], ['Columbia', 'SC'], ['Columbus', 'GA'], ['Columbus', 'OH'],
  ['Concord', 'NH'], ['Coral Springs', 'FL'], ['Corpus Christi', 'TX'], ['Costa Mesa', 'CA'],
  ['Dallas', 'TX'], ['Davenport', 'IA'], ['Dayton', 'OH'], ['Daytona Beach', 'FL'],
  ['Denver', 'CO'], ['Des Moines', 'IA'], ['Detroit', 'MI'], ['Dewitt', 'MI'],
  ['Dover', 'DE'], ['Duluth', 'MN'], ['Durham', 'NC'], ['East Lansing', 'MI'],
  ['Edmond', 'OK'], ['El Paso', 'TX'], ['Erie', 'PA'], ['Eugene', 'OR'],
  ['Evansville', 'IN'], ['Fairbanks', 'AK'], ['Fargo', 'ND'], ['Fayetteville', 'AR'],
  ['Flagstaff', 'AZ'], ['Flint', 'MI'], ['Fort Collins', 'CO'], ['Fort Lauderdale', 'FL'],
  ['Fort Myers', 'FL'], ['Fort Smith', 'AR'], ['Fort Wayne', 'IN'], ['Fort Worth', 'TX'],
  ['Frankfort', 'KY'], ['Fresno', 'CA'], ['Gainesville', 'FL'], ['Galveston', 'TX'],
  ['Garland', 'TX'], ['Glendale', 'AZ'], ['Grand Rapids', 'MI'], ['Greeley', 'CO'],
  ['Green Bay', 'WI'], ['Greensboro', 'NC'], ['Greenville', 'SC'], ['Hampton', 'VA'],
  ['Harrisburg', 'PA'], ['Hartford', 'CT'], ['Helena', 'MT'], ['Henderson', 'NV'],
  ['Hialeah', 'FL'], ['Hilo', 'HI'], ['Honolulu', 'HI'], ['Houston', 'TX'],
  ['Huntington Beach', 'CA'], ['Huntsville', 'AL'], ['Idaho Falls', 'ID'], ['Indianapolis', 'IN'],
  ['Iowa City', 'IA'], ['Irvine', 'CA'], ['Jackson', 'MS'], ['Jacksonville', 'FL'],
  ['Jefferson City', 'MO'], ['Jersey City', 'NJ'], ['Joliet', 'IL'], ['Juneau', 'AK'],
  ['Kalamazoo', 'MI'], ['Kansas City', 'KS'], ['Kansas City', 'MO'], ['Kennewick', 'WA'],
  ['Kingsport', 'TN'], ['Knoxville', 'TN'], ['Lafayette', 'LA'], ['Lakeland', 'FL'],
  ['Lansing', 'MI'], ['Laredo', 'TX'], ['Las Cruces', 'NM'], ['Las Vegas', 'NV'],
  ['Lawrence', 'KS'], ['Lawton', 'OK'], ['Lexington', 'KY'], ['Lincoln', 'NE'],
  ['Little Rock', 'AR'], ['Long Beach', 'CA'], ['Los Angeles', 'CA'], ['Louisville', 'KY'],
  ['Lubbock', 'TX'], ['Lynchburg', 'VA'], ['Macon', 'GA'], ['Madison', 'WI'],
  ['Manchester', 'NH'], ['Marietta', 'GA'], ['McAllen', 'TX'], ['Memphis', 'TN'],
  ['Mesa', 'AZ'], ['Miami', 'FL'], ['Midland', 'TX'], ['Milwaukee', 'WI'],
  ['Minneapolis', 'MN'], ['Mobile', 'AL'], ['Modesto', 'CA'], ['Monroe', 'LA'],
  ['Montgomery', 'AL'], ['Montpelier', 'VT'], ['Murfreesboro', 'TN'], ['Naples', 'FL'],
  ['Nashua', 'NH'], ['Nashville', 'TN'], ['New Bedford', 'MA'], ['New Haven', 'CT'],
  ['New Orleans', 'LA'], ['New York', 'NY'], ['Newark', 'NJ'], ['Newport News', 'VA'],
  ['Norfolk', 'VA'], ['North Las Vegas', 'NV'], ['Norwich', 'CT'], ['Oakland', 'CA'],
  ['Oklahoma City', 'OK'], ['Olympia', 'WA'], ['Omaha', 'NE'], ['Orlando', 'FL'],
  ['Overland Park', 'KS'], ['Owensboro', 'KY'], ['Oxnard', 'CA'], ['Palm Bay', 'FL'],
  ['Pasadena', 'CA'], ['Paterson', 'NJ'], ['Pensacola', 'FL'], ['Peoria', 'IL'],
  ['Philadelphia', 'PA'], ['Phoenix', 'AZ'], ['Pierre', 'SD'], ['Pittsburgh', 'PA'],
  ['Plano', 'TX'], ['Pocatello', 'ID'], ['Portland', 'ME'], ['Portland', 'OR'],
  ['Portsmouth', 'VA'], ['Providence', 'RI'], ['Provo', 'UT'], ['Pueblo', 'CO'],
  ['Raleigh', 'NC'], ['Rapid City', 'SD'], ['Reading', 'PA'], ['Reno', 'NV'],
  ['Richmond', 'VA'], ['Roanoke', 'VA'], ['Rochester', 'MN'], ['Rochester', 'NY'],
  ['Rockford', 'IL'], ['Roseville', 'CA'], ['Sacramento', 'CA'], ['Saint Louis', 'MO'],
  ['Saint Paul', 'MN'], ['Saint Petersburg', 'FL'], ['Salem', 'OR'], ['Salt Lake City', 'UT'],
  ['San Antonio', 'TX'], ['San Bernardino', 'CA'], ['San Diego', 'CA'], ['San Francisco', 'CA'],
  ['San Jose', 'CA'], ['Santa Ana', 'CA'], ['Santa Fe', 'NM'], ['Santa Rosa', 'CA'],
  ['Sarasota', 'FL'], ['Savannah', 'GA'], ['Scottsdale', 'AZ'], ['Seattle', 'WA'],
  ['Shreveport', 'LA'], ['Sioux City', 'IA'], ['Sioux Falls', 'SD'], ['South Bend', 'IN'],
  ['Spokane', 'WA'], ['Springfield', 'IL'], ['Springfield', 'MO'], ['Stamford', 'CT'],
  ['Stockton', 'CA'], ['Sunnyvale', 'CA'], ['Syracuse', 'NY'], ['Tacoma', 'WA'],
  ['Tallahassee', 'FL'], ['Tampa', 'FL'], ['Toledo', 'OH'], ['Topeka', 'KS'],
  ['Trenton', 'NJ'], ['Tucson', 'AZ'], ['Tulsa', 'OK'], ['Tuscaloosa', 'AL'],
  ['Tyler', 'TX'], ['Vallejo', 'CA'], ['Vancouver', 'WA'], ['Virginia Beach', 'VA'],
  ['Waco', 'TX'], ['Washington', 'DC'], ['Waterbury', 'CT'], ['West Palm Beach', 'FL'],
  ['Wichita', 'KS'], ['Wilmington', 'DE'], ['Wilmington', 'NC'], ['Worcester', 'MA'],
  ['Yakima', 'WA'], ['Yonkers', 'NY']
]

/** Age groups available for filtering / data generation. Junior
 *  brackets (8U..18U) sit alongside the senior brackets (30..85). */
export const AGE_GROUPS = [
  '8U', '10U', '12U', '14U', '16U', '18U',
  '30', '40', '45', '50', '55', '60', '65', '70', '75', '80', '85'
]

export const RATINGS = ['AA', 'AAA', 'Major', 'Major+', 'Major Gold']

export const GENDERS: Array<'Male' | 'Female' | 'Coed'> = ['Male', 'Female', 'Coed']

/** Demo sport-type seed — id + name pairs matching the sport-types catalogue
 *  (`sportTypes.ts`). Mock teams carry both `sportsTypeId` (FK) + the resolved
 *  `sportType` label, like the live join. */
const SPORT_TYPE_SEED = [
  { id: '1', name: 'Softball - Slow Pitch' },
  { id: '2', name: 'Softball - Fast Pitch' },
  { id: '3', name: 'Baseball' },
  { id: '4', name: 'Senior Softball' }
]

/** US state two-letter codes used by the State filter and by the
 *  city/state pool for team locations. */
export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI',
  'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN',
  'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH',
  'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY'
]

const MANAGER_FIRST_NAMES = [
  'Aaron', 'Anthony', 'Bob', 'Bret', 'Brian', 'Cindy', 'Dan', 'David', 'Edward',
  'Frank', 'Gary', 'Greg', 'Henry', 'Jack', 'James', 'Janet', 'Jerry', 'Joe',
  'John', 'Karen', 'Ken', 'Kenneth', 'Larry', 'Linda', 'Lou', 'Marcus', 'Mark',
  'Maria', 'Michael', 'Mike', 'Nathan', 'Pat', 'Paul', 'Phil', 'Ralph', 'Randy',
  'Ray', 'Rick', 'Rob', 'Ronald', 'Sam', 'Sandra', 'Scott', 'Steve', 'Susan',
  'Terry', 'Tim', 'Tom', 'Tony', 'Wayne', 'Will'
]

const MANAGER_LAST_NAMES = [
  'Adams', 'Albright', 'Anderson', 'Bailey', 'Brennan', 'Briggs', 'Brooks',
  'Calderon', 'Caldwell', 'Coleman', 'Davenport', 'Dunlap', 'Foster', 'Goodson',
  'Hansen', 'Hernandez', 'Holman', 'Howell', 'Lavoy', 'Marchetti', 'McEachrin',
  'Mason', 'McGrath', 'Melosi', 'Munoz', 'OBrien', 'OConnor', 'Park', 'Patterson',
  'Pavlicek', 'Pryor', 'Ramirez', 'Reilly', 'Rodriguez', 'Sandoval', 'Stephenson',
  'Stockton', 'Sullivan', 'Sutherland', 'Thompson', 'Torres', 'Vasquez', 'Webb',
  'Westbrook', 'Whitaker', 'Whitfield', 'Williams'
]

const MANAGER_EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net']

function buildMockTeams(): AssociationTeam[] {
  const total = 1710
  const baseTime = new Date('2026-04-30T00:00:00Z').getTime()
  const dayMs = 24 * 60 * 60 * 1000
  const list: AssociationTeam[] = []

  for (let i = 0; i < total; i++) {
    const namePoolIndex = (i * 37 + 11) % TEAM_NAME_POOL.length
    const baseName = TEAM_NAME_POOL[namePoolIndex]
    // Append a small numeric suffix for some teams so duplicates don't
    // appear identical in the list.
    const variant = Math.floor(i / TEAM_NAME_POOL.length) // 0..N
    const name = variant === 0 ? baseName : `${baseName} ${variant + 1}`

    const cityState = CITY_STATE_POOL[(i * 19 + 5) % CITY_STATE_POOL.length]
    const ageGroup = AGE_GROUPS[(i * 7 + 3) % AGE_GROUPS.length]
    const rating = RATINGS[(i * 13 + 1) % RATINGS.length]
    const gender = GENDERS[(i * 11 + 2) % GENDERS.length]
    const sport = SPORT_TYPE_SEED[(i * 5 + 2) % SPORT_TYPE_SEED.length]
    // Status mix: bulk active (~70%), then a sprinkling of pending,
    // expired, rejected, suspended so each filter option has data.
    const statusSeed = (i * 17 + 5) % 100
    let status: AssociationTeamStatus
    if (statusSeed < 70) status = 'active'
    else if (statusSeed < 82) status = 'pending'
    else if (statusSeed < 90) status = 'expired'
    else if (statusSeed < 96) status = 'rejected'
    else status = 'suspended'

    // Last-updated date — span the last ~10 years so the column has
    // varied values like "Feb 17, 2016" through "Apr 15, 2026".
    const ageDays = (i * 23 + 7) % 3650
    const lastUpdatedAt = new Date(baseTime - ageDays * dayMs).toISOString()

    // Reg numbers — system reg is SSUSA + zero-padded i; external reg
    // is a 4-digit numeric string from a different stride.
    const systemRegNo = `SSUSA${String(i + 1).padStart(5, '0')}`
    const externalRegNo = String(((i * 41 + 1009) % 9000) + 1000)

    const managerFirst = MANAGER_FIRST_NAMES[(i * 3 + 7) % MANAGER_FIRST_NAMES.length]
    const managerLast = MANAGER_LAST_NAMES[(i * 5 + 11) % MANAGER_LAST_NAMES.length]
    const managerName = `${managerFirst} ${managerLast}`
    const emailDomain = MANAGER_EMAIL_DOMAINS[i % MANAGER_EMAIL_DOMAINS.length]
    const managerEmail = `${managerFirst}.${managerLast}`.toLowerCase().replace(/[^a-z0-9.]/g, '') +
      `@${emailDomain}`
    // Phone — formatted (XXX) XXX-XXXX, deterministic per team.
    // Roughly 1-in-3 teams have no phone on file (empty string)
    // so the UI's missing-phone code path has visible coverage in
    // the mock data.
    let managerPhone = ''
    if ((i * 29 + 11) % 3 !== 0) {
      const ph1 = String(((i * 53 + 100) % 800) + 200)
      const ph2 = String(((i * 73 + 100) % 800) + 200)
      const ph3 = String(((i * 97 + 1000) % 9000) + 1000)
      managerPhone = `(${ph1}) ${ph2}-${ph3}`
    }

    // Roughly 1-in-8 teams have a "never expires" registration so
    // the corresponding UX path (Valid Thru → "Never Expires" + no
    // Renew button) is visible in the demo data.
    const neverExpires = (i * 31 + 7) % 8 === 0

    // Validity date — only set when the team isn't never-expires and
    // isn't pending. Pending teams have no validity until activated.
    let validUntil = ''
    if (!neverExpires && status !== 'pending') {
      // Derive a deterministic expiry: lastUpdatedAt + 1 year for
      // active/suspended (future), -30 days for expired, today for
      // rejected (irrelevant but keeps the field non-empty).
      const offsetDays =
        status === 'expired' ? -30
        : status === 'rejected' ? 0
        : 365
      const validUntilDate = new Date(new Date(lastUpdatedAt).getTime() + offsetDays * dayMs)
      validUntil = validUntilDate.toISOString().slice(0, 10)
    }

    list.push({
      id: `assoc-team-${i + 1}`,
      teamId: `t_${i + 1}`,
      name,
      status,
      gender,
      ageGroup,
      rating,
      sportsTypeId: sport.id,
      sportType: sport.name,
      city: cityState[0],
      state: cityState[1],
      lastUpdatedAt,
      systemRegNo,
      externalRegNo,
      managerName,
      managerEmail,
      managerPhone,
      neverExpires,
      validUntil
    })
  }

  // Targeted overrides for the demo so reviewers always see specific
  // states on specific named teams. Keeps the rest of the dataset
  // dynamic but pins these two for screenshots / walkthroughs.
  applyDemoOverrides(list)

  return list
}

/** Pin specific teams to specific states so the demo always shows
 *  the same UX paths on those rows regardless of seed math:
 *
 *    - Action Jackson  → Active + Never-Expires (no Renew button)
 *    - Boomerangs      → Active + concrete future expiry date
 *                        (renders a normal Valid Thru date)
 */
function applyDemoOverrides(list: AssociationTeam[]): void {
  const dayMs = 24 * 60 * 60 * 1000
  const today = new Date('2026-05-04T00:00:00Z')

  const actionJackson = list.find((team) => team.name === 'Action Jackson')
  if (actionJackson) {
    actionJackson.status = 'active'
    actionJackson.neverExpires = true
    actionJackson.validUntil = ''
  }

  const boomerangs = list.find((team) => team.name === 'Boomerangs')
  if (boomerangs) {
    boomerangs.status = 'active'
    boomerangs.neverExpires = false
    // Set lastUpdatedAt 4 months ago, validUntil 8 months ahead —
    // gives the demo a believable upcoming expiry.
    boomerangs.lastUpdatedAt = new Date(today.getTime() - 120 * dayMs).toISOString()
    boomerangs.validUntil = new Date(today.getTime() + 240 * dayMs).toISOString().slice(0, 10)
  }
}

let mockTeams: AssociationTeam[] = buildMockTeams()

export async function fetchAssociationTeams(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _associationShortName: string
): Promise<AssociationTeam[]> {
  // The list is the lightweight base shape — `customFields` are omitted here
  // (per the contract); fetch get-one to load them. Mirrors the live API.
  return delay(mockTeams.map((team) => {
    const row = { ...team }
    delete row.customFields
    return row
  }))
}

/** Optional "activate while registering" block. When present on a
 *  register call, the team is created Active with this validity (and a
 *  `mark_active` lifecycle row is appended) instead of starting Pending. */
export interface RegisterTeamActivation {
  neverExpires: boolean
  /** ISO date (YYYY-MM-DD). Required when `neverExpires` is false. */
  validUntil?: string
  source: 'payment' | 'manual'
  /** Required when `source === 'payment'`. */
  paymentOrderId?: string
  reason?: string
}

/** Payload for the Register / Edit Team wizard. */
export interface RegisterAssociationTeamPayload {
  name: string
  externalRegNo: string
  city: string
  state: string
  /** Coarse region grouping (shared regions catalogue). */
  region: string
  gender: 'Male' | 'Female' | 'Coed'
  /** Age-group catalogue FK (`age_group_id`). */
  ageGroupId: string
  /** Association ratings FK (`rating_id`). */
  ratingId: string
  /** Sport-type catalogue FK (`sports_type_id`). */
  sportsTypeId: string
  /** User-input "last updated" freshness date (`YYYY-MM-DD`) → `last_update_date`.
   *  Distinct from the system `updated_at`; always sent from the form. */
  lastUpdateDate: string
  managerName: string
  managerEmail: string
  /** Country dial code, e.g. "+1". */
  managerDialCode: string
  /** Raw national digits (no formatting). */
  managerPhone: string
  /** Linked WIF user id when the manager email matched an existing
   *  account; `null` when no match (an invite is sent instead). */
  managerLinkedUserId?: string | null
  /** True when the manager isn't on WIF yet — the backend emails a
   *  team-member invite on create. */
  sendManagerInvite?: boolean
  /** Wizard-chosen initial status on create — `'pending'` or `'active'`.
   *  `'active'` requires `activation`. Create-only (ignored on edit). */
  registrationStatus?: 'pending' | 'active'
  /** Team custom-field answers (Additional-details step). */
  customFields?: { definitionId: string; value: string }[]
  /** Payment collection choice when the association's team reg-settings make a
   *  fee applicable. The backend reads this + `association_reg_settings` to
   *  create the payment order / payable (fee = `applicable_fee`, not
   *  overridable here). Omitted when no fee applies. */
  payment?: {
    /** `later` = create the order unpaid, collect from the Statement later;
     *  `online` = create + send the manager a Stripe payment link;
     *  `offline` = record a manual payment now (cash / cheque / …). */
    collection: 'later' | 'online' | 'offline'
    method?: 'cash' | 'cheque' | 'check' | 'bank_transfer' | 'other'
    /** Manual (offline) payment amount being recorded now — may be a partial
     *  payment (less than the payable), leaving a balance to collect later. */
    amount?: number
    /** Date the manual payment was received (`YYYY-MM-DD`). */
    paidAt?: string
    reference?: string
    notes?: string
  } | null
  /** Data URL of the team logo selected via the cropper (mock stores it
   *  directly as `avatarUrl`; the live backend takes a multipart file). */
  logoDataUrl?: string | null
  /** Present only on register-and-activate (create flow, activation
   *  toggle ON). Omitted/null → team is created Pending. */
  activation?: RegisterTeamActivation | null
}

/** Append a freshly-registered team to the in-memory roster.
 *  Generates a sequential SSUSA system reg number, sets status to
 *  'pending' (every new registration starts pending until approved),
 *  and stamps `lastUpdatedAt` with the current time. */
export async function registerAssociationTeam(
  associationShortName: string,
  payload: RegisterAssociationTeamPayload
): Promise<AssociationTeam> {
  const nextIndex = mockTeams.length + 1
  const activation = payload.activation ?? null
  // The lifecycle rows happened "now"; the team's `last_update_date` is the
  // admin-entered freshness date (falls back to now when blank).
  const nowIso = new Date().toISOString()
  // Resolve display labels from the catalogues (backend joins these on read).
  const sportTypeName = (await fetchSportType(payload.sportsTypeId))?.name ?? ''
  const ageGroupLabel = await ageGroupName(payload.ageGroupId)
  const ratingLabel = await ratingName(associationShortName, payload.ratingId)
  // The wizard sends an explicit initial status; fall back to "activation
  // present → active" for older callers.
  const isActive = payload.registrationStatus
    ? payload.registrationStatus === 'active'
    : !!activation
  const team: AssociationTeam = {
    id: `assoc-team-new-${Date.now()}`,
    // The backend creates (or resolves) the global `teams` row on register;
    // the mock mints a stable stand-in id.
    teamId: `t_new-${Date.now()}`,
    name: payload.name,
    avatarUrl: payload.logoDataUrl || undefined,
    status: isActive ? 'active' : 'pending',
    gender: payload.gender,
    ageGroup: ageGroupLabel,
    ageGroupId: payload.ageGroupId,
    rating: ratingLabel,
    ratingId: payload.ratingId,
    sportsTypeId: payload.sportsTypeId,
    sportType: sportTypeName,
    city: payload.city,
    state: payload.state,
    region: payload.region,
    lastUpdatedAt: lastUpdatedIso(payload.lastUpdateDate),
    systemRegNo: `SSUSA${String(nextIndex).padStart(5, '0')}`,
    externalRegNo: payload.externalRegNo,
    managerName: payload.managerName,
    managerEmail: payload.managerEmail,
    managerDialCode: payload.managerDialCode,
    managerPhone: payload.managerPhone,
    managerLinkedUserId: payload.managerLinkedUserId ?? null,
    customFields: payload.customFields ?? [],
    neverExpires: isActive && activation ? activation.neverExpires : false,
    validUntil: isActive && activation && !activation.neverExpires ? activation.validUntil ?? '' : ''
  }
  mockTeams = [team, ...mockTeams]

  // Lifecycle: every new registration logs `register`; an activate-on-create
  // also logs `mark_active` so the timeline matches the standalone flow.
  appendLifecycleEntry({
    id: nextLifecycleId(),
    associationTeamId: team.id,
    teamId: team.id,
    actionType: 'register',
    actorUserId: CURRENT_ADMIN.id,
    actorName: CURRENT_ADMIN.name,
    occurredAt: nowIso,
    fromStatus: null,
    toStatus: 'pending',
    fromNeverExpires: null,
    fromValidUntil: null,
    toNeverExpires: false,
    toValidUntil: null,
    source: null,
    paymentOrderId: null,
    paymentReference: null,
    amount: null,
    reason: null,
    metadata: payload.sendManagerInvite ? { managerInvite: payload.managerEmail } : {},
    createdAt: nowIso,
    updatedAt: nowIso
  })
  if (isActive && activation) {
    appendLifecycleEntry({
      id: nextLifecycleId(),
      associationTeamId: team.id,
      teamId: team.id,
      actionType: 'mark_active',
      actorUserId: CURRENT_ADMIN.id,
      actorName: CURRENT_ADMIN.name,
      occurredAt: nowIso,
      fromStatus: 'pending',
      toStatus: 'active',
      fromNeverExpires: false,
      fromValidUntil: null,
      toNeverExpires: team.neverExpires,
      toValidUntil: team.validUntil || null,
      source: activation.source,
      paymentOrderId: activation.source === 'payment' ? activation.paymentOrderId ?? null : null,
      paymentReference: activation.source === 'payment' && activation.paymentOrderId
        ? `PO #${activation.paymentOrderId}`
        : null,
      amount: activation.source === 'payment' ? 75 : null,
      reason: activation.reason || null,
      metadata: {},
      createdAt: nowIso,
      updatedAt: nowIso
    })
  }

  return delay({ ...team })
}

/** Update an existing team's editable fields. Status + system reg
 *  number are NOT changed by the modal (those are admin-controlled
 *  elsewhere), but every other field can be edited. `lastUpdatedAt`
 *  is bumped to "now" on every save. */
export async function updateAssociationTeam(
  associationShortName: string,
  teamId: string,
  payload: RegisterAssociationTeamPayload
): Promise<AssociationTeam> {
  const index = mockTeams.findIndex((team) => team.id === teamId)
  if (index === -1) {
    throw new Error(`Team ${teamId} not found`)
  }
  const sportTypeName = (await fetchSportType(payload.sportsTypeId))?.name ?? ''
  const ageGroupLabel = await ageGroupName(payload.ageGroupId)
  const ratingLabel = await ratingName(associationShortName, payload.ratingId)
  const updated: AssociationTeam = {
    ...mockTeams[index],
    name: payload.name,
    avatarUrl: payload.logoDataUrl !== undefined
      ? (payload.logoDataUrl || undefined)
      : mockTeams[index].avatarUrl,
    gender: payload.gender,
    ageGroup: ageGroupLabel,
    ageGroupId: payload.ageGroupId,
    rating: ratingLabel,
    ratingId: payload.ratingId,
    sportsTypeId: payload.sportsTypeId,
    sportType: sportTypeName,
    city: payload.city,
    state: payload.state,
    region: payload.region,
    externalRegNo: payload.externalRegNo,
    managerName: payload.managerName,
    managerEmail: payload.managerEmail,
    managerDialCode: payload.managerDialCode,
    managerPhone: payload.managerPhone,
    managerLinkedUserId: payload.managerLinkedUserId !== undefined
      ? payload.managerLinkedUserId
      : mockTeams[index].managerLinkedUserId,
    customFields: payload.customFields !== undefined
      ? payload.customFields
      : mockTeams[index].customFields,
    // User-input freshness date from the form (system `updated_at` is separate).
    lastUpdatedAt: lastUpdatedIso(payload.lastUpdateDate)
  }
  mockTeams = [
    ...mockTeams.slice(0, index),
    updated,
    ...mockTeams.slice(index + 1)
  ]
  return delay({ ...updated })
}

/** Validity payload — passed to every action that can change the
 *  team's expiry: mark-active, renew, reactivate, change-validity.
 *  Now extended with the audit-trail fields required by the
 *  `association_team_lifecycle` log:
 *
 *    - `reason`      — optional admin note (required for suspend &
 *                      reject; app validation enforces that on the
 *                      mutation-specific endpoints).
 *    - `source`      — only meaningful for `renew` / `mark_active`
 *                      flows; identifies whether the activation /
 *                      renewal came from a payment_order checkout
 *                      or was an admin-granted manual entry.
 *    - `paymentOrderId` — non-null when `source === 'payment'`. */
export interface ValidityPayload {
  neverExpires: boolean
  /** ISO date string (YYYY-MM-DD). Required when `neverExpires` is
   *  false; ignored otherwise. */
  validUntil?: string
  /** Free-text admin note — surfaces in the Lifecycle timeline. */
  reason?: string
  /** Renewal / activation source. Only set for renew / mark_active. */
  source?: 'payment' | 'manual'
  /** Logical FK to payment_order. Required when source === 'payment'. */
  paymentOrderId?: string
}

/** Suspend / reject payload — both flows require a reason. The app
 *  enforces the non-empty constraint that the DB intentionally
 *  doesn't (per the no-CHECK-constraints decision). */
export interface SuspendOrRejectPayload {
  reason: string
}

// In-memory lifecycle store. Keyed by `association_team_id`. The
// mock layer appends a new `TeamLifecycleEntry` whenever a status
// or validity mutation runs. The Lifecycle tab on the team-details
// page fetches via `fetchTeamLifecycle` — entries persist for the
// session so QA can verify the timeline accumulates.
const lifecycleByAssociationTeamId = new Map<string, TeamLifecycleEntry[]>()

// Vite HMR — keep the store across module hot-reloads so editing
// adjacent code in dev doesn't wipe an in-progress timeline. The
// `import.meta.hot.accept` callback would also work; using
// `dispose` lets us simply not clear the map. For initial seeding
// we re-run when the map is empty (see `ensureSeededLifecycle`).
if (import.meta.hot) {
  import.meta.hot.accept()
}

const LIFECYCLE_ADMINS = [
  { id: 'admin-1', name: 'Tom Whitesides' },
  { id: 'admin-2', name: 'Lisa Trent' },
  { id: 'admin-3', name: 'Marcus Holloway' },
  { id: 'admin-4', name: 'Patricia Vance' },
  { id: 'admin-5', name: 'Diego Mendez' }
]

// The "current admin" — every action triggered from the UI is
// attributed to this user in the mock. Real backend will read the
// authenticated user from the request session.
const CURRENT_ADMIN = LIFECYCLE_ADMINS[0]

let lifecycleIdCounter = 1
function nextLifecycleId(): string {
  return String(lifecycleIdCounter++)
}

/** Pick a deterministic admin for a seeded historical lifecycle
 *  entry so the same team always renders the same "processed by"
 *  name across reloads. */
function pickHistoricalAdmin(seed: number): { id: string; name: string } {
  return LIFECYCLE_ADMINS[seed % LIFECYCLE_ADMINS.length]
}

/** Internal — append a lifecycle entry. Returns the entry so the
 *  caller can use it (e.g. for the response payload). */
function appendLifecycleEntry(entry: TeamLifecycleEntry): TeamLifecycleEntry {
  const list = lifecycleByAssociationTeamId.get(entry.associationTeamId) ?? []
  list.push(entry)
  lifecycleByAssociationTeamId.set(entry.associationTeamId, list)
  return entry
}

/** Internal — write the team patch AND append the matching
 *  lifecycle entry in one go. Captures from/to status + validity
 *  from the team's current state vs the patch so callers don't
 *  have to repeat that boilerplate. */
function commitTeamUpdate(
  teamId: string,
  patch: Partial<AssociationTeam>,
  lifecycle: {
    actionType: TeamLifecycleActionType
    actor?: { id: string; name: string }
    occurredAt?: string
    reason?: string | null
    source?: 'payment' | 'manual' | null
    paymentOrderId?: string | null
    paymentReference?: string | null
    amount?: number | null
    metadata?: Record<string, unknown>
  }
): { team: AssociationTeam; entry: TeamLifecycleEntry } {
  const index = mockTeams.findIndex((team) => team.id === teamId)
  if (index === -1) throw new Error(`Team ${teamId} not found`)
  const before = mockTeams[index]
  const updated: AssociationTeam = {
    ...before,
    ...patch,
    lastUpdatedAt: new Date().toISOString()
  }
  mockTeams = [...mockTeams.slice(0, index), updated, ...mockTeams.slice(index + 1)]

  const actor = lifecycle.actor ?? CURRENT_ADMIN
  const occurredAt = lifecycle.occurredAt ?? new Date().toISOString()
  const entry: TeamLifecycleEntry = {
    id: nextLifecycleId(),
    associationTeamId: teamId,
    teamId,
    actionType: lifecycle.actionType,
    actorUserId: actor.id,
    actorName: actor.name,
    occurredAt,
    fromStatus: before.status,
    toStatus: updated.status,
    fromNeverExpires: before.neverExpires,
    fromValidUntil: before.validUntil || null,
    toNeverExpires: updated.neverExpires,
    toValidUntil: updated.validUntil || null,
    source: lifecycle.source ?? null,
    paymentOrderId: lifecycle.paymentOrderId ?? null,
    paymentReference: lifecycle.paymentReference ?? null,
    amount: lifecycle.amount ?? null,
    reason: lifecycle.reason ?? null,
    metadata: lifecycle.metadata ?? {},
    createdAt: occurredAt,
    updatedAt: occurredAt
  }
  appendLifecycleEntry(entry)
  return { team: updated, entry }
}

/** Mark a Pending team as Active. Requires a validity decision
 *  (Never Expires OR an explicit validUntil date) AND a source —
 *  paid or manual — so the activation is properly recorded in the
 *  lifecycle log. */
export async function markAssociationTeamActive(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _associationShortName: string,
  teamId: string,
  validity: ValidityPayload
): Promise<AssociationTeam> {
  const { team } = commitTeamUpdate(
    teamId,
    {
      status: 'active',
      neverExpires: validity.neverExpires,
      validUntil: validity.neverExpires ? '' : validity.validUntil ?? ''
    },
    {
      actionType: 'mark_active',
      reason: validity.reason || null,
      source: validity.source ?? 'manual',
      paymentOrderId: validity.source === 'payment' ? validity.paymentOrderId ?? null : null,
      paymentReference: validity.source === 'payment' && validity.paymentOrderId
        ? `PO #${validity.paymentOrderId}`
        : null,
      amount: validity.source === 'payment' ? 75 : null
    }
  )
  return delay({ ...team })
}

/** Renew an Expired team's registration. Flips status back to
 *  'active' and writes the new validity (Never Expires or an
 *  explicit validUntil date — the caller picks via the popup).
 *  Source distinguishes paid (linked to a payment_order) from
 *  manual (admin-granted) renewals. */
export async function renewAssociationTeam(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _associationShortName: string,
  teamId: string,
  validity: ValidityPayload
): Promise<AssociationTeam> {
  const { team } = commitTeamUpdate(
    teamId,
    {
      status: 'active',
      neverExpires: validity.neverExpires,
      validUntil: validity.neverExpires ? '' : validity.validUntil ?? ''
    },
    {
      actionType: 'renew',
      reason: validity.reason || null,
      source: validity.source ?? 'manual',
      paymentOrderId: validity.source === 'payment' ? validity.paymentOrderId ?? null : null,
      paymentReference: validity.source === 'payment' && validity.paymentOrderId
        ? `PO #${validity.paymentOrderId}`
        : null,
      amount: validity.source === 'payment' ? 75 : null
    }
  )
  return delay({ ...team })
}

/** Suspend a team's registration. Flips status to 'suspended'. The
 *  validity isn't changed by this action — when reactivated later,
 *  the admin re-picks. Reason is REQUIRED — caller is expected to
 *  collect it via SuspendTeamConfirmModal. */
export async function suspendAssociationTeam(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _associationShortName: string,
  teamId: string,
  payload: SuspendOrRejectPayload
): Promise<AssociationTeam> {
  if (!payload.reason || !payload.reason.trim()) {
    throw new Error('A reason is required when suspending a team.')
  }
  const { team } = commitTeamUpdate(
    teamId,
    { status: 'suspended' },
    { actionType: 'suspend', reason: payload.reason.trim() }
  )
  return delay({ ...team })
}

/** Reactivate a Suspended team — flip back to 'active' AND set the
 *  new validity (admin re-confirms via the same popup). */
export async function reactivateAssociationTeam(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _associationShortName: string,
  teamId: string,
  validity: ValidityPayload
): Promise<AssociationTeam> {
  const { team } = commitTeamUpdate(
    teamId,
    {
      status: 'active',
      neverExpires: validity.neverExpires,
      validUntil: validity.neverExpires ? '' : validity.validUntil ?? ''
    },
    {
      actionType: 'reactivate',
      reason: validity.reason || null
    }
  )
  return delay({ ...team })
}

/** Update an Active team's validity — toggle Never Expires or pick
 *  a new expiry date. Status stays Active. */
export async function updateAssociationTeamValidity(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _associationShortName: string,
  teamId: string,
  validity: ValidityPayload
): Promise<AssociationTeam> {
  const { team } = commitTeamUpdate(
    teamId,
    {
      neverExpires: validity.neverExpires,
      validUntil: validity.neverExpires ? '' : validity.validUntil ?? ''
    },
    {
      actionType: 'validity_change',
      reason: validity.reason || null
    }
  )
  return delay({ ...team })
}

/** Cancel a registration — flips status to `rejected` (per the
 *  decision to reuse the existing status enum value for both
 *  never-approved and admin-cancelled records). Reason REQUIRED. */
export async function rejectAssociationTeam(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _associationShortName: string,
  teamId: string,
  payload: SuspendOrRejectPayload
): Promise<AssociationTeam> {
  if (!payload.reason || !payload.reason.trim()) {
    throw new Error('A reason is required when cancelling a registration.')
  }
  const { team } = commitTeamUpdate(
    teamId,
    { status: 'rejected' },
    { actionType: 'reject', reason: payload.reason.trim() }
  )
  return delay({ ...team })
}

/** Look up a single team by id. Used by the team-details page —
 *  loaded directly from the route param. */
export async function fetchAssociationTeamById(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _associationShortName: string,
  teamId: string
): Promise<AssociationTeam | null> {
  const team = mockTeams.find((t) => t.id === teamId) ?? null
  return delay(team ? { ...team } : null)
}

/** Hand-crafted lifecycle log for the Action Jackson demo team.
 *  Walks through every `action_type` the system records so a single
 *  team-details page demonstrates the full range of timeline UI:
 *
 *    1. register             — initial creation
 *    2. mark_active (payment) — paid initial activation
 *    3. renew (payment)       — paid annual renewal
 *    4. renew (manual)        — comp / manual renewal with reason
 *    5. validity_change       — admin extends to "Never Expires"
 *    6. suspend               — flagged + suspended with reason
 *    7. reactivate            — un-suspended; admin lifts the hold
 *    8. reject                — registration cancelled (with reason)
 *    9. mark_active (manual)  — admin reverses the cancellation
 *
 *  Steps 8–9 are intentionally a "false reject + restore" pair so
 *  the team ends back in the active+never-expires state set by
 *  `applyDemoOverrides`, while still surfacing the `reject` row in
 *  the timeline. */
function buildActionJacksonLifecycle(team: AssociationTeam): TeamLifecycleEntry[] {
  const dayMs = 24 * 60 * 60 * 1000
  const now = new Date(team.lastUpdatedAt).getTime()
  const at = (offsetDays: number) => new Date(now - offsetDays * dayMs).toISOString()
  const dateOnly = (offsetDays: number) =>
    new Date(now - offsetDays * dayMs).toISOString().slice(0, 10)

  const admin = (i: number) => LIFECYCLE_ADMINS[i % LIFECYCLE_ADMINS.length]

  const make = (
    overrides: Partial<TeamLifecycleEntry> & {
      actionType: TeamLifecycleActionType
      occurredAt: string
      fromStatus: AssociationTeamStatus | null
      toStatus: AssociationTeamStatus
      fromNeverExpires: boolean | null
      fromValidUntil: string | null
      toNeverExpires: boolean
      toValidUntil: string | null
      actorIndex: number
    }
  ): TeamLifecycleEntry => {
    const a = admin(overrides.actorIndex)
    return {
      id: nextLifecycleId(),
      associationTeamId: team.id,
      teamId: team.id,
      actionType: overrides.actionType,
      actorUserId: a.id,
      actorName: a.name,
      occurredAt: overrides.occurredAt,
      fromStatus: overrides.fromStatus,
      toStatus: overrides.toStatus,
      fromNeverExpires: overrides.fromNeverExpires,
      fromValidUntil: overrides.fromValidUntil,
      toNeverExpires: overrides.toNeverExpires,
      toValidUntil: overrides.toValidUntil,
      source: overrides.source ?? null,
      paymentOrderId: overrides.paymentOrderId ?? null,
      paymentReference: overrides.paymentReference ?? null,
      amount: overrides.amount ?? null,
      reason: overrides.reason ?? null,
      metadata: overrides.metadata ?? {},
      createdAt: overrides.occurredAt,
      updatedAt: overrides.occurredAt
    }
  }

  // Validity dates — first cycle ends 1 year after activation; the
  // paid renewal advances it another year; the manual renewal a
  // third year; then validity_change flips to never_expires.
  const validAfterMarkActive = dateOnly(-(900 - 5))   // ~895 days back
  const validAfterPaidRenew  = dateOnly(-(900 - 5 - 365))
  const validAfterManualRenew = dateOnly(-(900 - 5 - 730))

  return [
    // 1) register
    make({
      actionType: 'register',
      occurredAt: at(900),
      fromStatus: null,
      toStatus: 'pending',
      fromNeverExpires: null,
      fromValidUntil: null,
      toNeverExpires: false,
      toValidUntil: null,
      actorIndex: 0
    }),
    // 2) mark_active — paid
    make({
      actionType: 'mark_active',
      occurredAt: at(895),
      fromStatus: 'pending',
      toStatus: 'active',
      fromNeverExpires: false,
      fromValidUntil: null,
      toNeverExpires: false,
      toValidUntil: validAfterMarkActive,
      source: 'payment',
      paymentOrderId: '100501',
      paymentReference: 'PO #100501',
      amount: 95,
      actorIndex: 1
    }),
    // 3) renew — paid
    make({
      actionType: 'renew',
      occurredAt: at(530),
      fromStatus: 'active',
      toStatus: 'active',
      fromNeverExpires: false,
      fromValidUntil: validAfterMarkActive,
      toNeverExpires: false,
      toValidUntil: validAfterPaidRenew,
      source: 'payment',
      paymentOrderId: '102204',
      paymentReference: 'PO #102204',
      amount: 95,
      actorIndex: 2
    }),
    // 4) renew — manual (comp)
    make({
      actionType: 'renew',
      occurredAt: at(165),
      fromStatus: 'active',
      toStatus: 'active',
      fromNeverExpires: false,
      fromValidUntil: validAfterPaidRenew,
      toNeverExpires: false,
      toValidUntil: validAfterManualRenew,
      source: 'manual',
      reason: 'Comp renewal — sponsorship credit applied.',
      actorIndex: 3
    }),
    // 5) validity_change — flip to Never Expires
    make({
      actionType: 'validity_change',
      occurredAt: at(120),
      fromStatus: 'active',
      toStatus: 'active',
      fromNeverExpires: false,
      fromValidUntil: validAfterManualRenew,
      toNeverExpires: true,
      toValidUntil: null,
      reason: 'Granted permanent membership at board meeting.',
      actorIndex: 4
    }),
    // 6) suspend — with required reason
    make({
      actionType: 'suspend',
      occurredAt: at(80),
      fromStatus: 'active',
      toStatus: 'suspended',
      fromNeverExpires: true,
      fromValidUntil: null,
      toNeverExpires: true,
      toValidUntil: null,
      reason: 'Pending review — scoring dispute reported by opposing team.',
      actorIndex: 0
    }),
    // 7) reactivate — review cleared
    make({
      actionType: 'reactivate',
      occurredAt: at(60),
      fromStatus: 'suspended',
      toStatus: 'active',
      fromNeverExpires: true,
      fromValidUntil: null,
      toNeverExpires: true,
      toValidUntil: null,
      reason: 'Review cleared — no infraction found.',
      actorIndex: 1
    }),
    // 8) reject — registration cancelled
    make({
      actionType: 'reject',
      occurredAt: at(35),
      fromStatus: 'active',
      toStatus: 'rejected',
      fromNeverExpires: true,
      fromValidUntil: null,
      toNeverExpires: true,
      toValidUntil: null,
      reason: 'Cancelled in error — see follow-up activation.',
      actorIndex: 2
    }),
    // 9) mark_active — admin reverses the erroneous cancellation
    make({
      actionType: 'mark_active',
      occurredAt: at(34),
      fromStatus: 'rejected',
      toStatus: 'active',
      fromNeverExpires: true,
      fromValidUntil: null,
      toNeverExpires: true,
      toValidUntil: null,
      source: 'manual',
      reason: 'Cancellation reversed — admin error corrected.',
      actorIndex: 3
    })
  ]
}

/** Seed a team's lifecycle log on first read. Generates a
 *  believable history matching the team's current state — same
 *  shape as the old renewal mock, but expanded to cover suspends
 *  and validity changes too. Idempotent: subsequent reads return
 *  the same list. Real-time mutations append on top. */
function ensureSeededLifecycle(team: AssociationTeam): TeamLifecycleEntry[] {
  if (lifecycleByAssociationTeamId.has(team.id)) {
    return lifecycleByAssociationTeamId.get(team.id)!
  }

  // Action Jackson is a demo team — its lifecycle is hand-crafted
  // to showcase every action_type the system records. Anyone giving
  // a portal walkthrough can land on this team and see all the
  // timeline variations (paid renew, manual renew, suspend with
  // reason, reactivate, validity change, reject, resurrected via
  // mark_active) without hunting across multiple records.
  if (team.name === 'Action Jackson') {
    const entries = buildActionJacksonLifecycle(team)
    lifecycleByAssociationTeamId.set(team.id, entries)
    return entries
  }

  const entries: TeamLifecycleEntry[] = []
  const indexMatch = /assoc-team-(\d+)/.exec(team.id)
  const seed = indexMatch ? Number(indexMatch[1]) : 1
  const dayMs = 24 * 60 * 60 * 1000
  const baseTime = new Date(team.lastUpdatedAt).getTime()

  // Initial registration — first row in the timeline. Walk back
  // far enough that subsequent renewals fit before `lastUpdatedAt`.
  const yearsBack = team.status === 'pending' || team.status === 'rejected' ? 0 : 1 + (seed % 4)
  const registerTime = baseTime - (yearsBack * 365 + 30) * dayMs
  const registerAdmin = pickHistoricalAdmin(seed)
  entries.push({
    id: nextLifecycleId(),
    associationTeamId: team.id,
    teamId: team.id,
    actionType: 'register',
    actorUserId: registerAdmin.id,
    actorName: registerAdmin.name,
    occurredAt: new Date(registerTime).toISOString(),
    fromStatus: null,
    toStatus: 'pending',
    fromNeverExpires: null,
    fromValidUntil: null,
    toNeverExpires: false,
    toValidUntil: null,
    source: null,
    paymentOrderId: null,
    paymentReference: null,
    amount: null,
    reason: null,
    metadata: {},
    createdAt: new Date(registerTime).toISOString(),
    updatedAt: new Date(registerTime).toISOString()
  })

  if (team.status === 'pending') {
    lifecycleByAssociationTeamId.set(team.id, entries)
    return entries
  }

  // Mark Active right after registration (a few days later).
  const markActiveTime = registerTime + 3 * dayMs
  const markActiveAdmin = pickHistoricalAdmin(seed + 1)
  const initialPaid = (seed * 13 + 5) % 10 < 7  // ~70% paid
  entries.push({
    id: nextLifecycleId(),
    associationTeamId: team.id,
    teamId: team.id,
    actionType: 'mark_active',
    actorUserId: markActiveAdmin.id,
    actorName: markActiveAdmin.name,
    occurredAt: new Date(markActiveTime).toISOString(),
    fromStatus: 'pending',
    toStatus: 'active',
    fromNeverExpires: false,
    fromValidUntil: null,
    toNeverExpires: false,
    toValidUntil: new Date(markActiveTime + 365 * dayMs).toISOString().slice(0, 10),
    source: initialPaid ? 'payment' : 'manual',
    paymentOrderId: initialPaid ? `${100000 + seed}` : null,
    paymentReference: initialPaid ? `PO #${100000 + seed}` : null,
    amount: initialPaid ? 75 + ((seed * 5) % 50) : null,
    reason: initialPaid ? null : 'Comp activation — legacy member',
    metadata: {},
    createdAt: new Date(markActiveTime).toISOString(),
    updatedAt: new Date(markActiveTime).toISOString()
  })

  // One renew per intervening year (yearsBack - 1) so the ages line up.
  let prevValidUntil = new Date(markActiveTime + 365 * dayMs).toISOString().slice(0, 10)
  for (let i = 1; i < yearsBack; i++) {
    const renewTime = markActiveTime + i * 365 * dayMs
    const admin = pickHistoricalAdmin(seed + i + 2)
    const paid = ((seed * 13 + i * 7) % 10) < 7  // ~70% paid
    const newValidUntil = new Date(renewTime + 365 * dayMs).toISOString().slice(0, 10)
    entries.push({
      id: nextLifecycleId(),
      associationTeamId: team.id,
      teamId: team.id,
      actionType: 'renew',
      actorUserId: admin.id,
      actorName: admin.name,
      occurredAt: new Date(renewTime).toISOString(),
      fromStatus: 'active',
      toStatus: 'active',
      fromNeverExpires: false,
      fromValidUntil: prevValidUntil,
      toNeverExpires: false,
      toValidUntil: newValidUntil,
      source: paid ? 'payment' : 'manual',
      paymentOrderId: paid ? `${200000 + seed * 10 + i}` : null,
      paymentReference: paid ? `PO #${200000 + seed * 10 + i}` : null,
      amount: paid ? 75 + ((seed * 5 + i * 11) % 50) : null,
      reason: paid ? null : 'Manual renewal granted by admin.',
      metadata: {},
      createdAt: new Date(renewTime).toISOString(),
      updatedAt: new Date(renewTime).toISOString()
    })
    prevValidUntil = newValidUntil
  }

  // Tail event matching the team's current status, when not active.
  if (team.status === 'suspended') {
    const suspendAdmin = pickHistoricalAdmin(seed + 9)
    entries.push({
      id: nextLifecycleId(),
      associationTeamId: team.id,
      teamId: team.id,
      actionType: 'suspend',
      actorUserId: suspendAdmin.id,
      actorName: suspendAdmin.name,
      occurredAt: team.lastUpdatedAt,
      fromStatus: 'active',
      toStatus: 'suspended',
      fromNeverExpires: false,
      fromValidUntil: prevValidUntil,
      toNeverExpires: false,
      toValidUntil: prevValidUntil,
      source: null,
      paymentOrderId: null,
      paymentReference: null,
      amount: null,
      reason: 'Pending review — flagged by association office.',
      metadata: {},
      createdAt: team.lastUpdatedAt,
      updatedAt: team.lastUpdatedAt
    })
  } else if (team.status === 'rejected') {
    const rejectAdmin = pickHistoricalAdmin(seed + 11)
    entries.push({
      id: nextLifecycleId(),
      associationTeamId: team.id,
      teamId: team.id,
      actionType: 'reject',
      actorUserId: rejectAdmin.id,
      actorName: rejectAdmin.name,
      occurredAt: team.lastUpdatedAt,
      fromStatus: yearsBack === 0 ? 'pending' : 'active',
      toStatus: 'rejected',
      fromNeverExpires: false,
      fromValidUntil: prevValidUntil,
      toNeverExpires: false,
      toValidUntil: prevValidUntil,
      source: null,
      paymentOrderId: null,
      paymentReference: null,
      amount: null,
      reason: 'Registration cancelled at admin request.',
      metadata: {},
      createdAt: team.lastUpdatedAt,
      updatedAt: team.lastUpdatedAt
    })
  } else if (team.status === 'expired') {
    // No tail event — expiry is a passive transition; the lifecycle
    // log captures it as a system-generated `validity_change` row
    // (out of scope for v1 mock seeding).
  }

  lifecycleByAssociationTeamId.set(team.id, entries)
  return entries
}

/** Paginated lifecycle log for one association registration — every status /
 *  validity transition since `register`. The log grows over time, so it's
 *  served a page at a time (default 25, newest-first). Optional `actionType`
 *  filter narrows to a subset of action types. Mirrors §11 of the teams
 *  contract. */
export async function fetchTeamLifecycle(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _associationShortName: string,
  teamId: string,
  opts: { page?: number; perPage?: number; order?: 'asc' | 'desc'; actionType?: TeamLifecycleActionType[] } = {}
): Promise<Paginated<TeamLifecycleEntry>> {
  const { page = 1, perPage = 25, order = 'desc', actionType } = opts
  const team = mockTeams.find((t) => t.id === teamId)
  if (!team) return delay(paginate<TeamLifecycleEntry>([], page, perPage))
  let entries = ensureSeededLifecycle(team)
  if (actionType && actionType.length) {
    entries = entries.filter((e) => actionType.includes(e.actionType))
  }
  const sorted = [...entries].sort((a, b) => {
    const diff = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
    return order === 'asc' ? diff : -diff
  })
  const copied = sorted.map((entry) => ({ ...entry, metadata: { ...entry.metadata } }))
  return delay(paginate(copied, page, perPage))
}

// Mock store for payment_orders. Each entry owns a list of
// payables (line items) plus the aggregated transaction ledger.
// Seeded lazily on first read so a team-details Payments tab has
// stable, deterministic data.
const ordersByAssociationTeamId = new Map<string, AssociationPaymentOrder[]>()
const payablesByAssociationTeamId = new Map<string, AssociationPayable[]>()

// Templates for mock payables. Each entry maps to a real
// `payables.related_entity_type` value so the listing exercises
// both code paths in the UI.
type PayableTemplate = {
  description: string
  baseAmount: number
  relatedEntityType: AssociationPayableRelatedEntityType
  /** Event name hydrated when `relatedEntityType === 'event_joined_team'`. */
  eventName?: string
}

const PAYABLE_TEMPLATES: PayableTemplate[] = [
  { description: 'Annual Registration Fee', baseAmount: 150, relatedEntityType: 'association_team' },
  { description: 'Spring Tournament Entry', baseAmount: 250, relatedEntityType: 'event_joined_team', eventName: 'Spring Classic' },
  { description: 'Summer Slam Entry Fee',  baseAmount: 300, relatedEntityType: 'event_joined_team', eventName: 'Summer Slam' },
  { description: 'Fall Classic Entry',     baseAmount: 200, relatedEntityType: 'event_joined_team', eventName: 'Fall Classic Showdown' },
  { description: 'League Insurance',       baseAmount: 75,  relatedEntityType: 'association_team' },
  { description: 'Field Booking Surcharge',baseAmount: 50,  relatedEntityType: 'association_team' }
]

const PAYMENT_METHODS_BY_TYPE: Record<AssociationPaymentMethodType, string> = {
  stripe: 'Credit Card',
  cash: 'Cash',
  manual: 'Manual Entry',
  cheque: 'Cheque',
  check: 'Check',
  mixed: 'Mixed'
}

const PAYMENT_METHOD_TYPES: AssociationPaymentMethodType[] = [
  'stripe', 'cash', 'cheque', 'manual'
]

function paymentCompletionFromAmounts(
  total: number,
  paid: number
): AssociationPaymentCompletionStatus {
  if (paid <= 0) return 'unpaid'
  if (paid < total) return 'partially_paid'
  return 'paid'
}

function payableStatusForCompletion(
  completion: AssociationPaymentCompletionStatus,
  expired: boolean
): AssociationPayableStatus {
  if (completion === 'paid') return 'paid'
  if (expired) return 'cancelled'
  if (completion === 'partially_paid') return 'payment_in_progress'
  return 'active'
}

function orderStatusForCompletion(
  completion: AssociationPaymentCompletionStatus,
  collectionMode: AssociationPaymentCollectionMode | null
): AssociationPaymentOrderStatus {
  if (completion === 'paid') return 'paid'
  if (completion === 'partially_paid') return 'processing'
  if (collectionMode === 'offline') return 'awaiting_offline_payment'
  return 'pending'
}

/** Hand-crafted Payments demo for the Action Jackson team. The
 *  list demonstrates every payment_completion_status state
 *  (paid / partially_paid / unpaid) across both related-entity
 *  types (association_team registration + event_joined_team
 *  tournament entries). Sorted newest-first by created_at. */
function buildActionJacksonPayments(team: AssociationTeam): {
  orders: AssociationPaymentOrder[]
  payables: AssociationPayable[]
} {
  const dayMs = 24 * 60 * 60 * 1000
  const now = new Date(team.lastUpdatedAt).getTime()
  const at = (offsetDays: number, hour = 9, minute = 30) => {
    const d = new Date(now - offsetDays * dayMs)
    d.setUTCHours(hour, minute, 0, 0)
    return d.toISOString()
  }
  const dateOnly = (offsetDays: number) =>
    new Date(now - offsetDays * dayMs).toISOString().slice(0, 10)

  // Helper for assembling a single-line order. Most demo orders
  // have one payable; the mixed example below builds its own.
  let nextOrderSeq = 1
  let nextPayableSeq = 1
  const buildSingleOrder = (cfg: {
    offsetDays: number
    hour?: number
    minute?: number
    description: string
    relatedEntityType: AssociationPayableRelatedEntityType
    eventName?: string | null
    unitAmount: number
    discountAmount?: number
    methodType: AssociationPaymentMethodType | null
    collectionMode: AssociationPaymentCollectionMode | null
    completion: AssociationPaymentCompletionStatus
    expired?: boolean
  }): { order: AssociationPaymentOrder; payables: AssociationPayable[] } => {
    const issuedAt = at(cfg.offsetDays, cfg.hour, cfg.minute)
    const dueDate = dateOnly(cfg.offsetDays - 30)
    // Gross total = unit × qty (qty is 1 for these singles).
    // Platform fee is 3.5 % of (gross − discount); the displayed
    // "Payable" amount = (gross − discount) + platform fee.
    const grossTotal = cfg.unitAmount
    const discount = cfg.discountAmount ?? 0
    const platformFee = Math.round((grossTotal - discount) * 0.035 * 100) / 100
    const payable = grossTotal - discount + platformFee
    let paid = 0
    if (cfg.completion === 'paid') paid = payable
    else if (cfg.completion === 'partially_paid') paid = Math.round(payable * 0.4)
    const balance = payable - paid
    const orderId = String(900000 + (nextOrderSeq++))
    const orderNumber = `PO-${new Date(issuedAt).getUTCFullYear()}-${String(900 + nextOrderSeq).padStart(5, '0')}`
    const orderStatus: AssociationPaymentOrderStatus = cfg.expired
      ? 'expired'
      : cfg.completion === 'paid'
        ? 'paid'
        : cfg.completion === 'partially_paid'
          ? 'processing'
          : cfg.collectionMode === 'offline'
            ? 'awaiting_offline_payment'
            : 'pending'

    const transactions: AssociationPaymentTransaction[] = []
    if (paid > 0) {
      transactions.push({
        id: `${orderId}-tx-1`,
        paidAt: at(cfg.offsetDays - 2, 14, 5),
        amount: paid,
        method: cfg.methodType ? PAYMENT_METHODS_BY_TYPE[cfg.methodType] : 'Credit Card',
        reference: `TXN-${orderId}-A`
      })
    }

    const payableId = String(950000 + (nextPayableSeq++))
    const payableLine: AssociationPayable = {
      id: payableId,
      paymentOrderId: orderId,
      paymentOrderNumber: orderNumber,
      description: cfg.description,
      relatedEntityType: cfg.relatedEntityType,
      eventName: cfg.eventName ?? null,
      quantity: 1,
      unitAmount: cfg.unitAmount,
      totalAmount: grossTotal,
      discountAmount: discount,
      platformFeeAmount: platformFee,
      paidAmount: paid,
      balanceAmount: balance,
      currency: 'USD',
      paymentCompletionStatus: cfg.completion,
      status: payableStatusForCompletion(cfg.completion, !!cfg.expired),
      dueAt: dueDate,
      expiresAt: cfg.expired ? dateOnly(cfg.offsetDays - 60) : null,
      paidAt: cfg.completion === 'paid' ? at(cfg.offsetDays - 2, 14, 5) : null,
      createdAt: issuedAt,
      updatedAt: issuedAt
    }
    const order: AssociationPaymentOrder = {
      id: orderId,
      orderNumber,
      orderType: 'single',
      paymentMethodType: cfg.methodType,
      collectionMode: cfg.collectionMode,
      currency: 'USD',
      totalAmount: grossTotal,
      discountAmount: discount,
      platformFeeAmount: platformFee,
      paidAmount: paid,
      balanceAmount: balance,
      paymentCompletionStatus: cfg.completion,
      paymentProofStatus:
        cfg.collectionMode === 'offline' && cfg.completion !== 'paid'
          ? 'pending_verification'
          : 'not_required',
      status: orderStatus,
      paidAt: cfg.completion === 'paid' ? at(cfg.offsetDays - 2, 14, 5) : null,
      failedAt: null,
      expiredAt: cfg.expired ? at(cfg.offsetDays - 60, 23, 59) : null,
      cancelledAt: null,
      createdAt: issuedAt,
      updatedAt: issuedAt,
      transactions
    }
    return { order, payables: [payableLine] }
  }

  const built = [
    // Recent unpaid event participation (offline awaiting payment)
    buildSingleOrder({
      offsetDays: 5, hour: 16, minute: 22,
      description: 'Team Event Participation — Spring Classic 2025',
      relatedEntityType: 'event_joined_team',
      eventName: 'Spring Classic 2025',
      unitAmount: 275, methodType: 'cheque', collectionMode: 'offline',
      completion: 'unpaid'
    }),
    // Partially paid event participation (online stripe)
    buildSingleOrder({
      offsetDays: 18, hour: 11, minute: 4,
      description: 'Team Event Participation — Summer Slam Championship',
      relatedEntityType: 'event_joined_team',
      eventName: 'Summer Slam Championship',
      unitAmount: 350, methodType: 'stripe', collectionMode: 'online',
      completion: 'partially_paid'
    }),
    // Paid annual registration (online stripe)
    buildSingleOrder({
      offsetDays: 90, hour: 9, minute: 12,
      description: 'Team Association Registration — 2025 Season',
      relatedEntityType: 'association_team',
      unitAmount: 150, discountAmount: 15,
      methodType: 'stripe', collectionMode: 'online',
      completion: 'paid'
    }),
    // Paid event participation (cash collected at field)
    buildSingleOrder({
      offsetDays: 145, hour: 10, minute: 51,
      description: 'Team Event Participation — Fall Classic Showdown 2024',
      relatedEntityType: 'event_joined_team',
      eventName: 'Fall Classic Showdown 2024',
      unitAmount: 200,
      methodType: 'cash', collectionMode: 'offline',
      completion: 'paid'
    }),
    // Older paid annual registration (online stripe)
    buildSingleOrder({
      offsetDays: 455, hour: 8, minute: 33,
      description: 'Team Association Registration — 2024 Season',
      relatedEntityType: 'association_team',
      unitAmount: 150, methodType: 'stripe', collectionMode: 'online',
      completion: 'paid'
    })
  ]

  const orders = built.map((b) => b.order)
  const payables = built.flatMap((b) => b.payables)
  // Already in newest-first order via construction; sort defensively.
  orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  payables.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return { orders, payables }
}

/** Generate a deterministic set of orders + payables for a team.
 *  Each order is `single` (one payable) or `mixed` (2-3 payables);
 *  status mix covers paid / partially-paid / unpaid / awaiting-
 *  offline / cancelled so the listing renders the full UI range. */
/** Stamp the shared-list filter columns onto seeded payables — `itemType`
 *  (from the related-entity discriminator) + the dedicated `teamId` column
 *  (these are team payables). Keeps the generic `fetchPayables` filterable. */
function decoratePayableColumns(
  payables: AssociationPayable[],
  team: AssociationTeam
): AssociationPayable[] {
  return payables.map((p) => ({
    ...p,
    itemType:
      p.relatedEntityType === 'association_team'
        ? 'association_team_registration'
        : p.relatedEntityType === 'event_joined_team'
          ? 'event_team_registration'
          : p.itemType,
    // Mock keys payables by the association_team id (what the Statement tab
    // passes); the live wire would carry the global team_id here.
    teamId: team.id,
    userId: null,
    playerId: null,
    umpireId: null,
    eventId: p.eventId ?? null
  }))
}

function ensureSeededPayments(team: AssociationTeam): {
  orders: AssociationPaymentOrder[]
  payables: AssociationPayable[]
} {
  if (
    ordersByAssociationTeamId.has(team.id)
    && payablesByAssociationTeamId.has(team.id)
  ) {
    return {
      orders: ordersByAssociationTeamId.get(team.id)!,
      payables: payablesByAssociationTeamId.get(team.id)!
    }
  }

  // Action Jackson is a demo team — its payments tab is hand-
  // crafted so a walkthrough hits every payment_completion_status
  // (paid / partially_paid / unpaid) and both related_entity_type
  // values (association_team registration + event_joined_team
  // tournament entries).
  if (team.name === 'Action Jackson') {
    const seeded = buildActionJacksonPayments(team)
    seeded.payables = decoratePayableColumns(seeded.payables, team)
    ordersByAssociationTeamId.set(team.id, seeded.orders)
    payablesByAssociationTeamId.set(team.id, seeded.payables)
    return seeded
  }

  const dayMs = 24 * 60 * 60 * 1000
  const baseTime = new Date(team.lastUpdatedAt).getTime()
  const indexMatch = /assoc-team-(\d+)/.exec(team.id)
  const seed = indexMatch ? Number(indexMatch[1]) : 1

  const orders: AssociationPaymentOrder[] = []
  const payables: AssociationPayable[] = []

  // 2-5 orders per team.
  const orderCount = ((seed * 7 + 3) % 4) + 2

  for (let oi = 0; oi < orderCount; oi++) {
    const issuedAt = new Date(baseTime - (oi * 60 + 15) * dayMs)
    const dueAt = new Date(issuedAt.getTime() + 45 * dayMs)
    const orderType = (seed + oi) % 3 === 0 ? 'mixed' : 'single'
    const lineCount = orderType === 'mixed' ? 2 + ((seed + oi) % 2) : 1

    // Decide order status mix — distribution: ~55% paid, ~15%
    // partially_paid, ~15% unpaid (pending), ~10% awaiting offline
    // payment, ~5% cancelled.
    const statusRoll = (seed * 23 + oi * 11) % 100
    let collectionMode: AssociationPaymentCollectionMode | null
    let methodType: AssociationPaymentMethodType | null
    let intendedCompletion: AssociationPaymentCompletionStatus
    let expired = false

    if (statusRoll < 55) {
      collectionMode = 'online'
      methodType = 'stripe'
      intendedCompletion = 'paid'
    } else if (statusRoll < 70) {
      collectionMode = 'online'
      methodType = 'stripe'
      intendedCompletion = 'partially_paid'
    } else if (statusRoll < 85) {
      collectionMode = 'online'
      methodType = null
      intendedCompletion = 'unpaid'
    } else if (statusRoll < 95) {
      collectionMode = 'offline'
      methodType = PAYMENT_METHOD_TYPES[(seed + oi) % PAYMENT_METHOD_TYPES.length]
      intendedCompletion = 'unpaid'
    } else {
      collectionMode = 'online'
      methodType = null
      intendedCompletion = 'unpaid'
      expired = true
    }

    // Build line items first; aggregate amounts onto the order.
    // Per-line semantics:
    //   totalAmount      = unit × qty                 (gross)
    //   discountAmount   = applied per line
    //   platformFeeAmount = 3.5 % of (gross − discount)
    //   payable          = totalAmount − discount + platformFee  (computed)
    //   paidAmount       = derived from completion state
    //   balanceAmount    = payable − paidAmount        (pre-calculated)
    let totalGross = 0
    let totalDiscount = 0
    let totalPlatformFee = 0
    let totalPaid = 0
    const orderId = String(100000 + seed * 100 + oi)
    const orderNumber = `PO-${new Date(issuedAt).getUTCFullYear()}-${String(100 + oi).padStart(5, '0')}`
    const orderPayables: AssociationPayable[] = []

    for (let li = 0; li < lineCount; li++) {
      const tmpl = PAYABLE_TEMPLATES[(seed + oi * 3 + li * 5) % PAYABLE_TEMPLATES.length]
      const quantity = 1
      const unitAmount = tmpl.baseAmount + ((seed * 5 + oi * 13 + li * 7) % 80)
      const grossLineTotal = unitAmount * quantity
      const discount = (oi + li) % 4 === 0 ? Math.round(grossLineTotal * 0.1) : 0
      // Platform fee — 3.5 % of the post-discount net, rounded to
      // the nearest cent. Mirrors a typical Stripe-style cut.
      const platformFee = Math.round((grossLineTotal - discount) * 0.035 * 100) / 100
      const payableLine = grossLineTotal - discount + platformFee

      // Per-line paid amount derived from the order's intended
      // completion. Mixed orders: keep all lines aligned to the
      // order-level state so payment_completion_status stays
      // consistent across the line items.
      let linePaid = 0
      if (intendedCompletion === 'paid') {
        linePaid = payableLine
      } else if (intendedCompletion === 'partially_paid') {
        linePaid = Math.round(payableLine * 0.4)
      }
      const lineBalance = payableLine - linePaid

      totalGross += grossLineTotal
      totalDiscount += discount
      totalPlatformFee += platformFee
      totalPaid += linePaid

      const lineCompletion = paymentCompletionFromAmounts(payableLine, linePaid)
      const payableId = String(200000 + seed * 1000 + oi * 10 + li)
      const paidAt = lineCompletion === 'paid'
        ? new Date(issuedAt.getTime() + 7 * dayMs).toISOString()
        : null
      orderPayables.push({
        id: payableId,
        paymentOrderId: orderId,
        paymentOrderNumber: orderNumber,
        description: `${tmpl.description} — ${new Date(issuedAt).getUTCFullYear()} Season`,
        relatedEntityType: tmpl.relatedEntityType,
        eventName: tmpl.eventName ?? null,
        quantity,
        unitAmount,
        totalAmount: grossLineTotal,
        discountAmount: discount,
        platformFeeAmount: platformFee,
        paidAmount: linePaid,
        balanceAmount: lineBalance,
        currency: 'USD',
        paymentCompletionStatus: lineCompletion,
        status: payableStatusForCompletion(lineCompletion, expired),
        dueAt: dueAt.toISOString().slice(0, 10),
        expiresAt: expired ? new Date(dueAt.getTime() + 7 * dayMs).toISOString().slice(0, 10) : null,
        paidAt,
        createdAt: issuedAt.toISOString(),
        updatedAt: issuedAt.toISOString()
      })
    }

    const orderPayable = totalGross - totalDiscount + totalPlatformFee
    const orderCompletion = paymentCompletionFromAmounts(orderPayable, totalPaid)
    let orderStatus: AssociationPaymentOrderStatus
    if (expired) orderStatus = 'expired'
    else if (orderCompletion === 'paid') orderStatus = 'paid'
    else orderStatus = orderStatusForCompletion(orderCompletion, collectionMode)

    // Build the transaction ledger for the order (paid / partial
    // states only).
    const transactions: AssociationPaymentTransaction[] = []
    if (orderCompletion === 'paid') {
      const txCount = (seed + oi) % 3 === 0 ? 2 : 1
      let remaining = totalPaid
      for (let ti = 0; ti < txCount; ti++) {
        const isLast = ti === txCount - 1
        const amt = isLast ? remaining : Math.round(remaining * 0.4)
        remaining -= amt
        transactions.push({
          id: `${orderId}-tx-${ti}`,
          paidAt: new Date(issuedAt.getTime() + (ti + 1) * 5 * dayMs).toISOString(),
          amount: amt,
          method: methodType ? PAYMENT_METHODS_BY_TYPE[methodType] : 'Credit Card',
          reference: `TXN-${seed * 1000 + oi * 100 + ti * 10 + 7000}`
        })
      }
    } else if (orderCompletion === 'partially_paid') {
      transactions.push({
        id: `${orderId}-tx-0`,
        paidAt: new Date(issuedAt.getTime() + 5 * dayMs).toISOString(),
        amount: totalPaid,
        method: methodType ? PAYMENT_METHODS_BY_TYPE[methodType] : 'Credit Card',
        reference: `TXN-${seed * 1000 + oi * 100 + 5000}`
      })
    }

    const order: AssociationPaymentOrder = {
      id: orderId,
      orderNumber,
      orderType,
      paymentMethodType: methodType,
      collectionMode,
      currency: 'USD',
      totalAmount: totalGross,
      discountAmount: totalDiscount,
      platformFeeAmount: totalPlatformFee,
      paidAmount: totalPaid,
      balanceAmount: orderPayable - totalPaid,
      paymentCompletionStatus: orderCompletion,
      paymentProofStatus:
        collectionMode === 'offline' && orderCompletion !== 'paid'
          ? 'pending_verification'
          : 'not_required',
      status: orderStatus,
      paidAt: orderStatus === 'paid'
        ? new Date(issuedAt.getTime() + 10 * dayMs).toISOString()
        : null,
      failedAt: null,
      expiredAt: expired ? new Date(dueAt.getTime() + 7 * dayMs).toISOString() : null,
      cancelledAt: null,
      createdAt: issuedAt.toISOString(),
      updatedAt: issuedAt.toISOString(),
      transactions
    }
    orders.push(order)
    payables.push(...orderPayables)
  }

  // Sort newest first so the listing reads top-down.
  orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  payables.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const decorated = decoratePayableColumns(payables, team)
  ordersByAssociationTeamId.set(team.id, orders)
  payablesByAssociationTeamId.set(team.id, decorated)
  return { orders, payables: decorated }
}

/** Filters for the shared, paginated payables list — mirrors
 *  `association-payables-api-contract.md` §1. All optional; combine with AND. */
export interface PayableFilters {
  teamId?: string
  userId?: string
  playerId?: string
  umpireId?: string
  eventId?: string
  /** `payment_item_types.code` values (e.g. `association_team_registration`). */
  itemType?: string[]
  /** Rolled-up completion status: `unpaid` | `partially_paid` | `paid`. */
  paymentStatus?: AssociationPaymentCompletionStatus[]
  search?: string
  sort?: 'createdAt' | 'totalAmount' | 'balanceAmount'
  order?: 'asc' | 'desc'
  page?: number
  perPage?: number
}

/** The shared, filterable, paginated payables list — one entry point for the
 *  team Statement (filter `teamId`), the future player/umpire statements
 *  (`userId`), and association payment reports (filter by status / item type /
 *  event). Mirrors §1 of the payables contract. Mock: flattens every seeded
 *  team's payables, then filters + paginates. */
export async function fetchPayables(filters: PayableFilters = {}): Promise<Paginated<AssociationPayable>> {
  const {
    teamId, userId, playerId, umpireId, eventId,
    itemType, paymentStatus, search,
    sort = 'createdAt', order = 'desc', page = 1, perPage = 25
  } = filters

  // Seed + flatten payables across all teams (mock — live filters in SQL).
  let rows: AssociationPayable[] = []
  for (const t of mockTeams) {
    rows.push(...ensureSeededPayments(t).payables)
  }

  if (teamId) rows = rows.filter((p) => p.teamId === teamId)
  if (userId) rows = rows.filter((p) => p.userId === userId)
  if (playerId) rows = rows.filter((p) => p.playerId === playerId)
  if (umpireId) rows = rows.filter((p) => p.umpireId === umpireId)
  if (eventId) rows = rows.filter((p) => p.eventId === eventId)
  if (itemType && itemType.length) rows = rows.filter((p) => !!p.itemType && itemType.includes(p.itemType))
  if (paymentStatus && paymentStatus.length) rows = rows.filter((p) => paymentStatus.includes(p.paymentCompletionStatus))
  if (search && search.trim()) {
    const q = search.trim().toLowerCase()
    rows = rows.filter((p) =>
      p.paymentOrderNumber.toLowerCase().includes(q)
      || p.description.toLowerCase().includes(q)
      || (p.eventName?.toLowerCase().includes(q) ?? false)
    )
  }

  const dir = order === 'asc' ? 1 : -1
  rows = [...rows].sort((a, b) => {
    if (sort === 'totalAmount') return (a.totalAmount - b.totalAmount) * dir
    if (sort === 'balanceAmount') return (a.balanceAmount - b.balanceAmount) * dir
    return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir
  })

  return delay(paginate(rows.map((p) => ({ ...p })), page, perPage))
}

/** Team-Statement convenience wrapper over {@link fetchPayables} — this team's
 *  payables, newest-first, paginated (default 25). */
export async function fetchTeamPayables(
  _associationShortName: string,
  teamId: string,
  opts: { page?: number; perPage?: number; paymentStatus?: AssociationPaymentCompletionStatus[] } = {}
): Promise<Paginated<AssociationPayable>> {
  void _associationShortName
  return fetchPayables({ teamId, ...opts })
}

/** Hydrate one payment order with its payables + transactions.
 *  Used by the team-details Payments drill-in modal. */
export async function fetchPaymentOrder(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _associationShortName: string,
  teamId: string,
  paymentOrderId: string
): Promise<{
  order: AssociationPaymentOrder
  payables: AssociationPayable[]
} | null> {
  const team = mockTeams.find((t) => t.id === teamId)
  if (!team) return delay(null)
  const { orders, payables } = ensureSeededPayments(team)
  const order = orders.find((o) => o.id === paymentOrderId)
  if (!order) return delay(null)
  const lines = payables.filter((p) => p.paymentOrderId === paymentOrderId)
  return delay({
    order: {
      ...order,
      transactions: order.transactions.map((t) => ({ ...t }))
    },
    payables: lines.map((p) => ({ ...p }))
  })
}

/** Map a free-text method label → the order's `payment_method_type`. */
function methodToOrderType(method: string): AssociationPaymentMethodType {
  const m = method.toLowerCase()
  if (m.includes('cash')) return 'cash'
  if (m.includes('che')) return 'cheque'
  return 'manual'
}

/**
 * Record a MANUAL payment (cash / cheque / etc.) against an order — the
 * Statement drill-in's "Record payment" action. Appends a transaction,
 * recomputes the order + its payables (paid / balance / completion / status),
 * and when the order is fully paid, activates the linked team registration.
 * Backend owns this for real; the mock mutates the in-memory store.
 */
export async function recordTeamPayment(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _associationShortName: string,
  teamId: string,
  paymentOrderId: string,
  input: { method: string; amount: number; paidAt?: string; reference?: string; notes?: string }
): Promise<{ order: AssociationPaymentOrder; payables: AssociationPayable[] } | null> {
  const team = mockTeams.find((t) => t.id === teamId)
  if (!team) return delay(null)
  const { orders, payables } = ensureSeededPayments(team)
  const order = orders.find((o) => o.id === paymentOrderId)
  if (!order) return delay(null)

  const now = new Date().toISOString()
  // Date the payment was received (admin-entered) → the transaction's
  // processed/paid timestamp; falls back to now when omitted/invalid.
  const paidAtIso = input.paidAt && /^\d{4}-\d{2}-\d{2}$/.test(input.paidAt)
    ? new Date(`${input.paidAt}T00:00:00.000Z`).toISOString()
    : now
  order.transactions.push({
    id: `txn-${Date.now()}`,
    paidAt: paidAtIso,
    amount: input.amount,
    method: input.method,
    reference: input.reference ?? ''
  })
  const grand = order.totalAmount - order.discountAmount + order.platformFeeAmount
  order.paidAmount = Math.min(grand, order.paidAmount + input.amount)
  order.balanceAmount = Math.max(0, grand - order.paidAmount)
  order.paymentCompletionStatus = order.balanceAmount <= 0 ? 'paid' : order.paidAmount > 0 ? 'partially_paid' : 'unpaid'
  order.paymentMethodType = methodToOrderType(input.method)
  order.collectionMode = 'offline'
  order.updatedAt = now

  if (order.balanceAmount <= 0) {
    order.status = 'paid'
    order.paidAt = paidAtIso
    order.paymentProofStatus = 'verified'
    payables
      .filter((p) => p.paymentOrderId === paymentOrderId)
      .forEach((p) => {
        p.paidAmount = p.totalAmount - p.discountAmount + p.platformFeeAmount
        p.balanceAmount = 0
        p.paymentCompletionStatus = 'paid'
        p.status = 'paid'
      })
    // Paying the registration fee in full activates a pending registration.
    if (team.status === 'pending') {
      commitTeamUpdate(team.id, { status: 'active' }, {
        actionType: 'mark_active',
        source: 'payment',
        paymentOrderId,
        paymentReference: `PO #${order.orderNumber}`,
        amount: input.amount
      })
    }
  }

  return delay({
    order: { ...order, transactions: order.transactions.map((t) => ({ ...t })) },
    payables: payables.filter((p) => p.paymentOrderId === paymentOrderId).map((p) => ({ ...p }))
  })
}

/**
 * Send the manager a Stripe payment link for an order (online collection).
 * Mock stub: flips the order to an awaiting-online state. Backend creates the
 * Stripe checkout + emails the link for real.
 */
export async function sendTeamPaymentLink(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _associationShortName: string,
  teamId: string,
  paymentOrderId: string
): Promise<{ order: AssociationPaymentOrder; payables: AssociationPayable[] } | null> {
  const team = mockTeams.find((t) => t.id === teamId)
  if (!team) return delay(null)
  const { orders, payables } = ensureSeededPayments(team)
  const order = orders.find((o) => o.id === paymentOrderId)
  if (!order) return delay(null)
  order.status = 'checkout_created'
  order.collectionMode = 'online'
  order.paymentMethodType = 'stripe'
  order.updatedAt = new Date().toISOString()
  return delay({
    order: { ...order, transactions: order.transactions.map((t) => ({ ...t })) },
    payables: payables.filter((p) => p.paymentOrderId === paymentOrderId).map((p) => ({ ...p }))
  })
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    mockTeams = buildMockTeams()
  })
}
