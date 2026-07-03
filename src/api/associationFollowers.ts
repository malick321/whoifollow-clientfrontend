import type { AssociationFollower } from '../types'

/**
 * Frontend-only mock layer for the Association Followers listing.
 * v1 generates 1,247 followers deterministically from name pools so
 * reloads show the same data and continuous-scroll has volume.
 */

const SIMULATED_LATENCY_MS = 320

function delay<T>(value: T, ms = SIMULATED_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

// Realistic-but-fictional name pools. Same flavour as the team
// manager pool so the lists feel like they belong to the same
// platform.
const FIRST_NAMES = [
  'Aaron', 'Adam', 'Alan', 'Alex', 'Andrew', 'Anthony', 'Ben', 'Bill', 'Bob',
  'Brad', 'Brian', 'Bruce', 'Bryan', 'Calvin', 'Carlos', 'Charles', 'Chris',
  'Clark', 'Cody', 'Craig', 'Curtis', 'Dale', 'Dan', 'Daniel', 'Darren', 'Dave',
  'David', 'Dean', 'Denis', 'Dennis', 'Derek', 'Don', 'Doug', 'Drew', 'Earl',
  'Ed', 'Eddie', 'Edward', 'Eric', 'Ernie', 'Ethan', 'Evan', 'Floyd', 'Frank',
  'Fred', 'Gary', 'Gene', 'George', 'Glen', 'Greg', 'Hank', 'Harold', 'Harry',
  'Henry', 'Howard', 'Ian', 'Jack', 'Jacob', 'Jake', 'James', 'Jared', 'Jason',
  'Jeff', 'Jeremy', 'Jerry', 'Jesse', 'Jim', 'Joe', 'Joel', 'John', 'Jon',
  'Jordan', 'Joseph', 'Josh', 'Justin', 'Keith', 'Kelvin', 'Ken', 'Kenneth',
  'Kevin', 'Kirk', 'Kurt', 'Larry', 'Lawrence', 'Lee', 'Leo', 'Lester', 'Logan',
  'Lou', 'Louis', 'Luke', 'Mark', 'Marshall', 'Martin', 'Marty', 'Marvin',
  'Matt', 'Matthew', 'Max', 'Michael', 'Mike', 'Miles', 'Nathan', 'Neil',
  'Nelson', 'Nick', 'Noah', 'Norm', 'Oliver', 'Oscar', 'Pat', 'Patrick',
  'Paul', 'Pete', 'Peter', 'Phil', 'Quincy', 'Ralph', 'Randall', 'Randy',
  'Ray', 'Reggie', 'Rich', 'Richard', 'Rick', 'Rob', 'Robert', 'Rod', 'Roger',
  'Ron', 'Ronald', 'Roy', 'Russell', 'Ryan', 'Sam', 'Scott', 'Sean', 'Seth',
  'Stan', 'Stanley', 'Stephen', 'Steve', 'Stuart', 'Ted', 'Terry', 'Theodore',
  'Thomas', 'Tim', 'Todd', 'Tom', 'Tony', 'Travis', 'Trevor', 'Troy', 'Tyler',
  'Vernon', 'Victor', 'Vince', 'Walt', 'Walter', 'Warren', 'Wayne', 'Wesley',
  'Will', 'William', 'Willie', 'Zach'
]

const LAST_NAMES = [
  'Albachten', 'Allen', 'Anderson', 'Atkins', 'Bailey', 'Baker', 'Barnes',
  'Bauer', 'Bell', 'Bennett', 'Berg', 'Bishop', 'Black', 'Boyd', 'Brennan',
  'Brooks', 'Brown', 'Bryant', 'Burke', 'Burns', 'Butler', 'Cain', 'Caldwell',
  'Cameron', 'Campbell', 'Carter', 'Carvajal', 'Chen', 'Clark', 'Cole',
  'Coleman', 'Collier', 'Collins', 'Conway', 'Cook', 'Cooper', 'Cox', 'Crawford',
  'Curtis', 'Davenport', 'Davis', 'Dawson', 'Day', 'Diaz', 'Dixon', 'Donovan',
  'Dorney', 'Doyle', 'Drake', 'Duncan', 'Edwards', 'Ellis', 'Evans', 'Farrell',
  'Faulkner', 'Ferguson', 'Fisher', 'Fleming', 'Fletcher', 'Flynn', 'Ford',
  'Foster', 'Fowler', 'Fox', 'Franklin', 'Fuller', 'Garcia', 'Garrett',
  'Gibson', 'Gilbert', 'Glass', 'Goodman', 'Graham', 'Grant', 'Gray',
  'Greene', 'Griffin', 'Hale', 'Hall', 'Hamilton', 'Hansen', 'Harper',
  'Harris', 'Hayes', 'Henderson', 'Hicks', 'Hill', 'Holland', 'Holloway',
  'Hopkins', 'Howell', 'Hudson', 'Hughes', 'Hunt', 'Irwin', 'Jackson',
  'James', 'Jensen', 'Johnson', 'Jones', 'Jordan', 'Keller', 'Kelly',
  'Kennedy', 'King', 'Knight', 'Lambert', 'Lawson', 'Lee', 'Lewis', 'Long',
  'Lowry', 'Lucas', 'Lyons', 'Mack', 'Mason', 'Matthews', 'May', 'McAllister',
  'McGrath', 'Mendez', 'Miller', 'Mills', 'Mitchell', 'Moore', 'Morgan',
  'Morris', 'Murphy', 'Murray', 'Nelson', 'Newman', 'Newton', 'Nichols',
  'OConnor', 'Olsen', 'Owens', 'Palmer', 'Park', 'Parker', 'Patel', 'Patterson',
  'Payne', 'Pearson', 'Perkins', 'Perry', 'Phillips', 'Pierce', 'Porter',
  'Powell', 'Pratt', 'Pring', 'Quinn', 'Ramos', 'Reed', 'Reeves', 'Reid',
  'Reilly', 'Reynolds', 'Rhodes', 'Rice', 'Richardson', 'Riley', 'Rivera',
  'Roberts', 'Robinson', 'Rogers', 'Ross', 'Russell', 'Ryan', 'Sanders',
  'Scott', 'Sharp', 'Shaw', 'Sheridan', 'Sherman', 'Simmons', 'Simpson',
  'Sims', 'Sinclair', 'Skinner', 'Smith', 'Spencer', 'Stanton', 'Stevens',
  'Stewart', 'Stone', 'Sullivan', 'Sutton', 'Tate', 'Taylor', 'Thompson',
  'Thornton', 'Torres', 'Townsend', 'Towne', 'Trackwell', 'Tucker', 'Turner',
  'Vance', 'Vaughn', 'Wade', 'Wagner', 'Walker', 'Wallace', 'Walsh', 'Walters',
  'Ward', 'Warner', 'Watson', 'Weaver', 'Webb', 'Wells', 'West', 'Wheeler',
  'White', 'Whitehead', 'Wilcox', 'Wilkins', 'Williams', 'Wilson', 'Winters',
  'Wood', 'Wright', 'York', 'Young'
]

function buildMockFollowers(): AssociationFollower[] {
  const total = 1247
  const baseTime = new Date('2026-05-04T00:00:00Z').getTime()
  const dayMs = 24 * 60 * 60 * 1000
  const list: AssociationFollower[] = []

  for (let i = 0; i < total; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length]
    const last = LAST_NAMES[(i * 7 + 3) % LAST_NAMES.length]
    const name = `${first} ${last}`

    // Followed dates span the last ~3 years, with the most recent
    // followers at the top of the list (newest first).
    const ageDays = (i * 5 + 2) % 1095
    const followedAt = new Date(baseTime - ageDays * dayMs).toISOString()

    list.push({
      id: `assoc-follower-${i + 1}`,
      name,
      followedAt
    })
  }

  // Sort newest-first so the listing matches the screenshot (May 04
  // entries above May 03 entries above May 02, etc.).
  return list.sort(
    (a, b) => new Date(b.followedAt).getTime() - new Date(a.followedAt).getTime()
  )
}

let mockFollowers: AssociationFollower[] = buildMockFollowers()

export async function fetchAssociationFollowers(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _associationShortName: string
): Promise<AssociationFollower[]> {
  return delay(mockFollowers.map((follower) => ({ ...follower })))
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    mockFollowers = buildMockFollowers()
  })
}
