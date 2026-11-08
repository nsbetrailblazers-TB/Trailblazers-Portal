// ==========================================================
// TRAILBLAZERS PORTAL
// app.js
// ==========================================================


// ==========================================================
// 1. SUPABASE
// ==========================================================

const SUPABASE_URL =
  "https://vldbxkbczkqwclbbifkb.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_xwOhMArnpsB_i_Ambjw-lg_iffd8Pt3";

const supabaseClient =
  supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );


// ==========================================================
// 2. PORTAL SETTINGS
// ==========================================================

let POINT_REQUIREMENT = 10;


// ==========================================================
// 3. APPLICATION STATE
// ==========================================================

let currentMember = null;
let sharedMemberView = false;
let hasSharedPortalAccess = false;
let currentMemberIsActive = false;

// Shared view-transition state is accessed by both member and director
// entry paths during login and session restoration. Initialize it with the
// rest of the app state before any view callbacks can run.
var portalNavigationVersion = 0;
var directorViewLoading = false;

let currentCohort = null;

let currentDirector = null;

let currentDirectorAssignment = null;

let currentDirectorCohort = null;

let currentPointSubmissions = [];

let currentOneOnOnes = [];

let currentStrikes = [];

let currentPortalEvents = [];

let currentCalendarItems = [];

let currentResources = [];

let currentAnnouncements = [];

let currentDirectorCalendarEvents = [];

let currentAlumni = [];

let currentNotifications = [];

let currentDirectorMembers = [];
let currentDirectorCalendarBirthdays = [];

let activeAlumniCohort = "all";
let alumniSortDirection = "asc";
let directorMemberSortDirection = "asc";

let editingDirectorEventId = null;

let directorCalendarCursor =
  new Date();

directorCalendarCursor.setDate(
  1
);

// ==========================================================
// 4. CALENDAR STATE
// ==========================================================

let calendarCursor =
  new Date();

calendarCursor =
  new Date(
    calendarCursor.getFullYear(),
    calendarCursor.getMonth(),
    1
  );


// ==========================================================
// 5. MAIN ELEMENTS
// ==========================================================

const loginPage =
  document.querySelector(
    ".login-page"
  );

const loginForm =
  document.getElementById(
    "loginForm"
  );

const dashboard =
  document.getElementById(
    "dashboard"
  );

const logoutButton =
  document.getElementById(
    "logoutButton"
  );

const directorDashboard =
  document.getElementById(
    "directorDashboard"
  );

const directorLogoutButton =
  document.getElementById(
    "directorLogoutButton"
  );

const navLinks =
  document.querySelectorAll(
    ".nav-link[data-page]"
  );

const directorNavLinks =
  document.querySelectorAll(
    ".director-nav-link"
  );

const directorHomePage =
  document.getElementById(
    "directorHomePage"
  );

const directorCalendarPage =
  document.getElementById(
    "directorCalendarPage"
  );

const directorCalendarCreateEventButton =
  document.getElementById(
    "directorCalendarCreateEventButton"
  );

const directorCreateEventButton =
  document.getElementById(
    "directorCreateEventButton"
  );

  const directorCalendarPreviousButton =
  document.getElementById(
    "directorCalendarPreviousButton"
  );

const directorCalendarTodayButton =
  document.getElementById(
    "directorCalendarTodayButton"
  );

const directorCalendarNextButton =
  document.getElementById(
    "directorCalendarNextButton"
  );

const directorCalendarMonthLabel =
  document.getElementById(
    "directorCalendarMonthLabel"
  );

const directorCalendarGrid =
  document.getElementById(
    "directorCalendarGrid"
  );

const directorCreateEventForm =
  document.getElementById(
    "directorCreateEventForm"
  );

const directorCancelEventButton =
  document.getElementById(
    "directorCancelEventButton"
  );

const directorEventForm =
  document.getElementById(
    "directorEventForm"
  );

const directorPages = [
  directorHomePage,
  directorCalendarPage,
  document.getElementById(
    "directorOneOnOnesPage"
  ),
  document.getElementById(
    "directorMembersPage"
  ),
  document.getElementById(
    "directorContentPage"
  )
];

const directorScheduleOneOnOneButton =
  document.getElementById(
    "directorScheduleOneOnOneButton"
  );

const directorScheduleOneOnOneForm =
  document.getElementById(
    "directorScheduleOneOnOneForm"
  );

const directorOneOnOneForm =
  document.getElementById(
    "directorOneOnOneForm"
  );

const directorCancelOneOnOneButton =
  document.getElementById(
    "directorCancelOneOnOneButton"
  );

// ==========================================================
// 6. MEMBER PORTAL PAGES
// ==========================================================

const homePage =
  document.getElementById(
    "homePage"
  );

const pointsPage =
  document.getElementById(
    "pointsPage"
  );

const oneOnOnesPage =
  document.getElementById(
    "oneOnOnesPage"
  );

const calendarPage =
  document.getElementById(
    "calendarPage"
  );

const profilePage =
  document.getElementById(
    "profilePage"
  );

const nsbeHubPage =
  document.getElementById(
    "nsbeHubPage"
  );

const resourcesPage =
  document.getElementById(
    "resourcesPage"
  );

const myCohortPage = document.getElementById("myCohortPage");
const excusePage = document.getElementById("excusePage");
let currentCohortDirectory = [];
let cohortDirectorySortDirection = "asc";


const allPages = [
  homePage,
  pointsPage,
  oneOnOnesPage,
  calendarPage,
  profilePage,
  nsbeHubPage,
  resourcesPage
  ,
  myCohortPage,
  excusePage,
  document.getElementById(
    "alumniPage"
  ),
  document.getElementById(
    "notificationsPage"
  )
];


// ==========================================================
// 7. GENERAL HELPERS
// ==========================================================

function setText(
  id,
  value
) {

  const element =
    document.getElementById(
      id
    );


  if (!element) {
    return;
  }


  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    element.textContent =
      "Not provided";

    return;

  }


  element.textContent =
    value;

}


function escapeHTML(
  value
) {

  const element =
    document.createElement(
      "div"
    );

  element.textContent =
    value ?? "";

  return element.innerHTML.replaceAll('"', '&quot;').replaceAll("'", '&#39;');

}


function safeURL(
  value
) {

  if (!value) {
    return null;
  }


  try {

    const url =
      new URL(
        value
      );


    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {

      return null;

    }


    return url.href;

  } catch {

    return null;

  }

}


function formatStatus(
  status
) {

  if (status === "denied") return "Rejected";

  if (!status) {
    return "Unknown";
  }


  return status
    .split("_")
    .map(
      word =>
        word.charAt(0)
          .toUpperCase() +
        word.slice(1)
    )
    .join(" ");

}


function formatBirthday(
  month,
  day
) {

  if (
    !month ||
    !day
  ) {

    return "Not provided";

  }


  const date =
    new Date(
      2000,
      month - 1,
      day
    );


  return date.toLocaleDateString(
    "en-US",
    {
      month: "long",
      day: "numeric"
    }
  );

}


function formatShortDate(
  dateValue
) {

  if (!dateValue) {
    return "—";
  }


  const date =
    new Date(
      dateValue
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return "—";

  }


  return date.toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric"
    }
  );

}


function formatFullDateTime(
  dateValue
) {

  if (!dateValue) {
    return "Date TBD";
  }


  const date =
    dateValue instanceof Date
      ? dateValue
      : new Date(
          dateValue
        );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return "Date TBD";

  }


  return date.toLocaleString(
    "en-US",
    {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }
  );

}


function formatCalendarTime(
  dateValue
) {

  if (!dateValue) {
    return "";
  }


  const date =
    dateValue instanceof Date
      ? dateValue
      : new Date(
          dateValue
        );


  return date.toLocaleTimeString(
    "en-US",
    {
      hour: "numeric",
      minute: "2-digit"
    }
  );

}


function getInitials(
  firstName,
  lastName
) {

  const first =
    firstName
      ?.charAt(0) ||
    "";

  const last =
    lastName
      ?.charAt(0) ||
    "";


  return (
    `${first}${last}`
      .toUpperCase() ||
    "--"
  );

}


function getEventCategoryLabel(
  category
) {

  if (
    category ===
    "nsbe_event"
  ) {

    return "NSBE Event";

  }


  if (
    category ===
    "one_on_one"
  ) {

    return "One-on-One";

  }


  return "TB Event";

}


function isFutureDate(
  dateValue
) {

  const date =
    dateValue instanceof Date
      ? dateValue
      : new Date(
          dateValue
        );


  return (
    !Number.isNaN(
      date.getTime()
    ) &&
    date >= new Date()
  );

}


// ==========================================================
// 8. PAGE NAVIGATION
// ==========================================================

function showPage(
  pageName
) {
  if (pageName === "mycohort" && (!currentMemberIsActive || sharedMemberView)) pageName = "resources";
  if (pageName === "excuse" && (!currentMemberIsActive || sharedMemberView)) pageName = "resources";
  if (sharedMemberView && !["resources", "nsbe", "alumni"].includes(pageName)) {
    pageName = "resources";
  }
  const bell=document.getElementById('notificationBell');if(bell)bell.hidden=!currentMember||sharedMemberView;
  if (pageName === "resources" && !sharedMemberView) window.PortalManagement?.refreshResume();
  if (pageName === "excuse" && !sharedMemberView) window.PortalManagement?.loadExcuseForm();
  if (pageName === "oneonones" && !sharedMemberView) window.PortalMeetings?.mount(document.getElementById('oneOnOnesPage'));

  const assignmentPage=document.getElementById("assignmentsPage");
  if(assignmentPage)assignmentPage.style.display="none";
  if(pageName==="assignments")window.PortalAssignments?.refreshMember();
  allPages.forEach(
    page => {

      if (page) {

        page.style.display =
          "none";

      }

    }
  );


  const pageMap = {
    assignments:document.getElementById("assignmentsPage"),

    home:
      homePage,

    points:
      pointsPage,

    oneonones:
      oneOnOnesPage,

    calendar:
      calendarPage,

    profile:
      profilePage,

    mycohort:
      myCohortPage,

    nsbe:
      nsbeHubPage,

    resources:
      resourcesPage,

    alumni:
      document.getElementById(
        "alumniPage"
      ),

    notifications:
      document.getElementById(
        "notificationsPage"
      ),

    excuse:
      excusePage

  };


  const selectedPage =
    pageMap[
      pageName
    ] ||
    homePage;


  if (selectedPage) {

    selectedPage.style.display =
      "block";

  }


  navLinks.forEach(
    button => {

      button.classList.toggle(
        "active",
        button.dataset.page ===
          pageName
      );

    }
  );


  if (
    pageName ===
    "calendar"
  ) {

    renderCalendar();

  }


  if (
    pageName ===
    "resources"
  ) {

    displayResources();

  }

  if (pageName === "alumni") {
    displayAlumni();
  }

  if (pageName === "notifications") {
    displayNotifications();
  }
  if (pageName === "mycohort") displayMemberCohort();

  const myCohortNav = document.getElementById("myCohortNav");
  if (myCohortNav) myCohortNav.hidden = !currentMemberIsActive || sharedMemberView;


  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });


  refreshRevealAnimations();

}


// Make available to HTML onclick buttons.
window.showPage =
  showPage;


// ==========================================================
// 9. SIDEBAR NAVIGATION
// ==========================================================

navLinks.forEach(
  button => {

    button.addEventListener(
      "click",
      function () {

        const pageName =
          button.dataset.page;


        showPage(
          pageName
        );

      }
    );

  }
);

// ==========================================================
// 9A. DIRECTOR PAGE NAVIGATION
// ==========================================================

function showDirectorPage(
  pageName
) {
  if(pageName==='directorOneOnOnes')window.PortalMeetings?.mount(document.getElementById('directorOneOnOnesPage'));

  directorPages.forEach(
    page => {

      if (page) {

        page.style.display =
          "none";

      }

    }
  );


  const directorPageMap = {

  directorHome:
    directorHomePage,

  directorCalendar:
    directorCalendarPage,

  directorOneOnOnes:
    document.getElementById(
      "directorOneOnOnesPage"
    ),

  directorMembers:
    document.getElementById(
      "directorMembersPage"
    ),

  directorContent:
    document.getElementById(
      "directorContentPage"
    )

};


  const selectedPage =
    directorPageMap[
      pageName
    ] ||
    directorHomePage;


  if (selectedPage) {

    selectedPage.style.display =
      "block";

  }


  directorNavLinks.forEach(
    button => {

      button.classList.toggle(
        "active",
        button.dataset.directorPage ===
          pageName
      );

    }
  );

  if (pageName === "directorMembers") {
    displayDirectorMembers();
  }


  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });


  refreshRevealAnimations();

}


directorNavLinks.forEach(
  button => {

    button.addEventListener(
      "click",
      function () {

        const pageName =
          button.dataset.directorPage;

        showDirectorPage(
          pageName
        );

      }
    );

  }
);

renderDirectorMonthlyCalendar();

document
  .querySelectorAll(
    "[data-director-page-link]"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        function () {

          const pageName =
            button.dataset
              .directorPageLink;

          showDirectorPage(
            pageName
          );

        }
      );

    }
  );


window.showDirectorPage =
  showDirectorPage;

// ==========================================================
// 9B. PORTAL VIEW SWITCHING
// ==========================================================

function showMemberPortal() {
  ++portalNavigationVersion;

  if (!currentMember) {

    alert(
      "This account does not have member access."
    );

    return;

  }

  sharedMemberView = false;
  document.querySelectorAll('.nav-link[data-page]').forEach(button => { button.hidden = false; });
  const excuseNav = document.getElementById("excuseNav");
  if (excuseNav) excuseNav.hidden = !currentMemberIsActive;


  loginPage.style.display =
    "none";


  if (directorDashboard) {

    directorDashboard.style.display =
      "none";

  }


  dashboard.style.display =
    "block";


  showPage(
    "home"
  );

}

async function showSharedMemberPortal() {
  if (!hasSharedPortalAccess) {
    alert("This account does not have shared portal access.");
    return;
  }
  ++portalNavigationVersion;
  sharedMemberView = true;
  loginPage.style.display = "none";
  if (directorDashboard) directorDashboard.style.display = "none";
  dashboard.style.display = "block";
  const role = document.querySelector("#dashboard .sidebar-role");
  if (role) role.textContent = "Member Portal";
  document.querySelectorAll('.nav-link[data-page]').forEach(button => {
    button.hidden = !["resources", "nsbe", "alumni"].includes(button.dataset.page);
  });
  currentResources = await loadResources();
  displayResources();
  await window.PortalInventory?.refreshHub();
  currentAlumni = await loadAlumni();
  displayAlumni();
  showPage("resources");
}


async function showDirectorPortal() {
  if (directorViewLoading) return;
  if (window.PortalManagement) {
    sharedMemberView = false;
    ++portalNavigationVersion;
    await window.PortalManagement.show('director','overview');
    return;
  }

  if (
    !currentDirector ||
    !currentDirectorAssignment
  ) {

    alert(
      "This account does not have director access."
    );

    return;

  }

  sharedMemberView = false;
  document.querySelectorAll('.nav-link[data-page]').forEach(button => { button.hidden = false; });
  const excuseNav = document.getElementById("excuseNav");
  if (excuseNav) excuseNav.hidden = !currentMemberIsActive;

  directorViewLoading = true;
  const navigationVersion = ++portalNavigationVersion;
  const triggers = document.querySelectorAll('#openDirectorViewButton, #managementDirectorView');
  triggers.forEach(b => { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
  const originalLabel = openDirectorViewButton?.innerHTML;
  if (openDirectorViewButton) openDirectorViewButton.textContent = 'Loading director view…';
  const refreshed = await refreshDirectorData().catch(error => {
    console.error("Director view could not load:", error);
    alert("Could not load the director view. Please refresh and try again.");
    return null;
  });
  directorViewLoading = false;
  triggers.forEach(b => { b.disabled = false; b.removeAttribute('aria-busy'); });
  if (openDirectorViewButton && originalLabel) openDirectorViewButton.innerHTML = originalLabel;
  if (!refreshed || !currentDirector || navigationVersion !== portalNavigationVersion) return;
  window.PortalManagement?.hide();

  loginPage.style.display =
    "none";


  dashboard.style.display =
    "none";


  if (directorDashboard) {

    directorDashboard.style.display =
      "block";

  }


  showDirectorPage(
    "directorHome"
  );

}


// ==========================================================
// 9C. PORTAL SWITCH BUTTONS
// ==========================================================

const openDirectorViewButton =
  document.getElementById(
    "openDirectorViewButton"
  );


const openMemberViewButton =
  document.getElementById(
    "openMemberViewButton"
  );


if (openDirectorViewButton) {

  openDirectorViewButton.addEventListener(
    "click",
    function () {

      showDirectorPortal();

    }
  );

}


if (openMemberViewButton) {

  openMemberViewButton.addEventListener(
    "click",
    async function () {
      try {
        if (currentMemberIsActive) { await refreshMemberData(); showMemberPortal(); }
        else await showSharedMemberPortal();
      }
      catch(error) { alert(error.message || 'Could not refresh member view.'); }
    }
  );

}


window.showMemberPortal =
  showMemberPortal;


window.showDirectorPortal =
  showDirectorPortal;

// ==========================================================
// 10. CURRENT AUTH USER
// ==========================================================

async function getCurrentAuthUser() {

  const {
    data: {
      user
    },
    error
  } =
    await supabaseClient
      .auth
      .getUser();


  if (error) {

    console.error(
      "Could not get current user:",
      error
    );

    return null;

  }


  return user;

}


// ==========================================================
// 11. CURRENT MEMBER
// ==========================================================

async function loadCurrentMember() {

  const user =
    await getCurrentAuthUser();


  if (!user) {

    return null;

  }


  const {
    data: member,
    error
  } =
    await supabaseClient
      .from(
        "members"
      )
      .select("*")
      .eq(
        "auth_user_id",
        user.id
      )
      .maybeSingle();


  if (error) {

    console.error(
      "Could not load member:",
      error
    );

    return null;

  }


  return member;

}

// ==========================================================
// 11A. CURRENT DIRECTOR
// ==========================================================

async function loadCurrentDirector() {

  const user =
    await getCurrentAuthUser();


  if (!user) {

    return null;

  }


  const {
    data: director,
    error
  } =
    await supabaseClient
      .from(
        "directors"
      )
      .select("*")
      .eq(
        "auth_user_id",
        user.id
      )
      .eq(
        "active",
        true
      )
      .maybeSingle();


  if (error) {

    console.error(
      "Could not load director:",
      error
    );

    return null;

  }


  return director;

}

// ==========================================================
// 11B. CURRENT DIRECTOR ASSIGNMENT
// ==========================================================

async function loadCurrentDirectorAssignment(
  directorId
) {

  if (!directorId) {

    return null;

  }


  const {
    data: assignments,
    error
  } =
    await supabaseClient
      .from(
        "director_assignments"
      )
      .select("*")
      .eq(
        "director_id",
        directorId
      )
      .eq(
        "active",
        true
      );


  if (error) {

    console.error(
      "Could not load director assignment:",
      error
    );

    return null;

  }


  if (
    !assignments ||
    assignments.length === 0
  ) {

    return null;

  }


  const today = new Date().toISOString().slice(0, 10);
  return assignments.find(a => (!a.start_date || a.start_date <= today) && (!a.end_date || a.end_date >= today)) || null;

}

// ==========================================================
// 12. CURRENT COHORT
// ==========================================================

async function loadCurrentCohort(
  cohortId
) {

  if (!cohortId) {

    return null;

  }


  const {
    data,
    error
  } =
    await supabaseClient
      .from(
        "cohorts"
      )
      .select(`
        id,
        name,
        class_number,
        status
      `)
      .eq(
        "id",
        cohortId
      )
      .single();


  if (error) {

    console.error(
      "Could not load cohort:",
      error
    );

    return null;

  }


  return data;

}

// ==========================================================
// 12A. REFRESH DIRECTOR DATA
// ==========================================================

async function refreshDirectorData() {

  const director =
    await loadCurrentDirector();


  if (!director) {

    currentDirector =
      null;

    currentDirectorAssignment =
      null;

    currentDirectorCohort =
      null;

    return null;

  }


  const assignment =
    await loadCurrentDirectorAssignment(
      director.id
    );


  if (!assignment) {

    currentDirector =
      director;

    currentDirectorAssignment =
      null;

    currentDirectorCohort =
      null;

    return null;

  }


  const cohort =
    await loadCurrentCohort(
      assignment.cohort_id
    );


  currentDirector =
    director;

  currentDirectorAssignment =
    assignment;

    currentDirectorCohort =
    cohort;


  displayCurrentDirector(
    director,
    assignment,
    cohort
  );

  // These independent requests previously ran one after another.
  const loads = {
    active: loadDirectorActiveMembersCount(cohort.id),
    meetingsCount: loadDirectorUpcomingOneOnOnesCount(assignment.id),
    points: loadDirectorPendingPointsCount(cohort.id),
    eventsCount: loadDirectorUpcomingEventsCount(cohort.id),
    meetings: loadDirectorUpcomingOneOnOnes(assignment.id),
    events: loadDirectorCalendarEvents(cohort.id),
    members: loadDirectorMembers()
  };
  await Promise.all(Object.values(loads));


  const activeMembersCount =
    await loads.active;


  setText(
    "directorActiveMembersCount",
    activeMembersCount
  );

  const upcomingOneOnOnesCount =
  await loads.meetingsCount;


setText(
  "directorUpcomingOneOnOnesCount",
  upcomingOneOnOnesCount
);


const pendingPointsCount =
  await loads.points;


setText(
  "directorPendingPointsCount",
  pendingPointsCount
);


const upcomingEventsCount =
  await loads.eventsCount;


setText(
  "directorUpcomingEventsCount",
  upcomingEventsCount
);


const upcomingOneOnOnes =
  await loads.meetings;


displayDirectorUpcomingOneOnOnes(
  upcomingOneOnOnes
);

displayDirectorOneOnOnes(
  upcomingOneOnOnes
);

const directorCalendarEvents =
  await loads.events;


displayDirectorCalendarEvents(
  directorCalendarEvents
);

renderDirectorMonthlyCalendar();

currentDirectorMembers =
  await loads.members;

populateDirectorOneOnOneMemberSelect();
displayDirectorMembers();

return {
  director,
  assignment,
  cohort
};

}

// ==========================================================
// 12B. DISPLAY DIRECTOR PROFILE
// ==========================================================

function displayCurrentDirector(
  director,
  assignment,
  cohort
) {

  if (
    !director ||
    !assignment
  ) {

    return;

  }


  const fullName =
    `${
      director.first_name ||
      ""
    } ${
      director.last_name ||
      ""
    }`.trim();


  const assignmentTitle =
    assignment.title ||
    director.title ||
    "Trailblazers Director";


  const cohortName =
    cohort
      ? (
          cohort.name ||
          `Class ${
            cohort.class_number
          }`
        )
      : "Cohort not assigned";


  setText(
    "directorHomeName",
    fullName
  );


  setText(
    "directorAssignmentTitle",
    assignmentTitle
  );


  setText(
    "directorCohortName",
    cohortName
  );


  setText(
    "directorSidebarCohort",
    cohortName
  );

}

// ==========================================================
// 12C. LOAD DIRECTOR ACTIVE MEMBERS COUNT
// ==========================================================

async function loadDirectorActiveMembersCount(
  cohortId
) {

  if (!cohortId) {
    return 0;
  }


  const {
    count,
    error
  } =
    await supabaseClient
      .from("members")
      .select(
        "id",
        {
          count: "exact",
          head: true
        }
      )
      .eq(
        "cohort_id",
        cohortId
      )
      .eq(
        "program_status",
        "active"
      );


  if (error) {

    console.error(
      "Could not load active member count:",
      error
    );

    return 0;

  }


  return count || 0;

}

// ==========================================================
// 12D. LOAD DIRECTOR UPCOMING ONE-ON-ONES COUNT
// ==========================================================

async function loadDirectorUpcomingOneOnOnesCount(
  directorAssignmentId
) {

  if (!directorAssignmentId) {
    return 0;
  }


  const now =
    new Date().toISOString();


  const {
    count,
    error
  } =
    await supabaseClient
      .from("one_on_ones")
      .select(
        "id",
        {
          count: "exact",
          head: true
        }
      )
      .eq(
        "director_assignment_id",
        directorAssignmentId
      )
      .in(
        "status",
        ["pending", "scheduled"]
      )
      .gte(
        "scheduled_date",
        now
      );


  if (error) {

    console.error(
      "Could not load upcoming one-on-one count:",
      error
    );

    return 0;

  }


  return count || 0;

}

// ==========================================================
// 12E. LOAD DIRECTOR PENDING POINT SUBMISSIONS COUNT
// ==========================================================

async function loadDirectorPendingPointsCount(
  cohortId
) {

  if (!cohortId) {
    return 0;
  }


  const {
    data: members,
    error: membersError
  } =
    await supabaseClient
      .from("members")
      .select("id")
      .eq(
        "cohort_id",
        cohortId
      );


  if (membersError) {

    console.error(
      "Could not load cohort members for pending points:",
      membersError
    );

    return 0;

  }


  if (
    !members ||
    members.length === 0
  ) {
    return 0;
  }


  const memberIds =
    members.map(
      member => member.id
    );


  const {
    count,
    error
  } =
    await supabaseClient
      .from("point_submissions")
      .select(
        "id",
        {
          count: "exact",
          head: true
        }
      )
      .in(
        "member_id",
        memberIds
      )
      .eq(
        "status",
        "pending"
      );


  if (error) {

    console.error(
      "Could not load pending point submissions count:",
      error
    );

    return 0;

  }


  return count || 0;

}

// ==========================================================
// 12F. LOAD DIRECTOR UPCOMING EVENTS COUNT
// ==========================================================

async function loadDirectorUpcomingEventsCount(
  cohortId
) {

  if (!cohortId) {
    return 0;
  }


  const now =
    new Date().toISOString();


  const {
    count,
    error
  } =
    await supabaseClient
      .from("meetings")
      .select(
        "id",
        {
          count: "exact",
          head: true
        }
      )
      .eq(
        "cohort_id",
        cohortId
      )
      .eq(
        "active",
        true
      )
      .gte(
        "start_time",
        now
      );


  if (error) {

    console.error(
      "Could not load upcoming events count:",
      error
    );

    return 0;

  }


  return count || 0;

}

// ==========================================================
// 12G. LOAD DIRECTOR UPCOMING ONE-ON-ONES
// ==========================================================

async function loadDirectorUpcomingOneOnOnes(
  directorAssignmentId
) {

  if (!directorAssignmentId) {
    return [];
  }


  const now =
    new Date().toISOString();


  const {
    data: oneOnOnes,
    error: oneOnOneError
  } =
    await supabaseClient
      .from("one_on_ones")
      .select(`
        id,
        member_id,
        director_id,
        director_assignment_id,
        status,
        scheduled_date,
        location_method,
        meeting_method
      `)
      .eq(
        "director_assignment_id",
        directorAssignmentId
      )
      .in(
        "status",
        ["pending", "scheduled", "completion_pending"]
      )
      .order(
        "scheduled_date",
        {
          ascending: true
        }
      );


  if (oneOnOneError) {

    console.error(
      "Could not load director upcoming one-on-ones:",
      oneOnOneError
    );

    return [];

  }


  if (
    !oneOnOnes ||
    oneOnOnes.length === 0
  ) {

    return [];

  }


  const memberIds =
    [
      ...new Set(
        oneOnOnes.map(
          record => record.member_id
        )
      )
    ];


  const {
    data: members,
    error: membersError
  } =
    await supabaseClient
      .from("members")
      .select(`
        id,
        first_name,
        last_name,
        preferred_name,
        uf_email
      `)
      .in(
        "id",
        memberIds
      );


  if (membersError) {

    console.error(
      "Could not load members for director one-on-ones:",
      membersError
    );

    return [];

  }


  const memberMap =
    new Map(
      (
        members ||
        []
      ).map(
        member => [
          member.id,
          member
        ]
      )
    );


  return oneOnOnes.map(
    record => ({
      ...record,

      member:
        memberMap.get(
          record.member_id
        ) ||
        null
    })
  );

}

// ==========================================================
// 12H. DISPLAY DIRECTOR UPCOMING ONE-ON-ONES
// ==========================================================

function displayDirectorUpcomingOneOnOnes(
  records
) {

  const container =
    document.getElementById(
      "directorUpcomingOneOnOnes"
    );


  if (!container) {
    return;
  }


  container.innerHTML =
    "";


  if (
    !records ||
    records.length === 0
  ) {

    container.innerHTML = `
      <div class="empty-state">
        No upcoming one-on-ones scheduled.
      </div>
    `;

    return;

  }


  records.forEach(
    record => {

      const member =
        record.member;


      const memberName =
        member
          ? `${
              member.preferred_name ||
              member.first_name ||
              "Member"
            } ${
              member.last_name ||
              ""
            }`.trim()
          : "Member";


      const meetingMethod =
        record.meeting_method ===
        "in_person"
          ? "In Person"
          : formatStatus(
              record.meeting_method
            );


      const location =
        record.location_method ||
        "Location TBD";


      const card =
        document.createElement(
          "div"
        );


      card.className =
        "director-upcoming-item";


      card.innerHTML = `
        <div class="director-upcoming-item-main">

          <strong>
            ${escapeHTML(
              memberName
            )}
          </strong>

          <span>
            ${escapeHTML(
              record.status === "pending" ? `Requested: ${formatFullDateTime(record.scheduled_date)}` : formatFullDateTime(record.scheduled_date)
            )}
          </span>

        </div>

        <div class="director-upcoming-item-details">

          <span>
            ${escapeHTML(
              record.status === "pending" ? "Waiting for your response" : meetingMethod
            )}
          </span>

          <span>
            ${escapeHTML(
              location
            )}
          </span>

        </div>
      `;

      appendDirectorMeetingActions(card, record);


      container.appendChild(
        card
      );

    }
  );

}

function appendDirectorMeetingActions(container, record) {
  if (record.status === 'completion_pending' || record.status === 'scheduled' && new Date(record.scheduled_date) <= new Date()) {
    const done=document.createElement('button');done.type='button';done.className='primary-button';done.textContent=record.status==='completion_pending'?'Approve completion':'Mark completed';
    done.onclick=async()=>{done.disabled=true;try{const r=await supabaseClient.rpc('portal_one_on_one_completion',{operation:'approve',record_id:record.id,payload:{}});if(r.error)throw r.error;await refreshDirectorData();}catch(e){alert(e.message);done.disabled=false;}};container.append(done);
    if(record.status==='completion_pending'){
      const review=document.createElement('button');review.type='button';review.className='secondary-button';review.textContent='Review / request correction';review.onclick=()=>PortalManagement.manageMeeting(record.id).catch(e=>alert(e.message));container.append(review);return;
    }
  }
  if (record.status === "scheduled") {
    if (!currentDirectorAssignment?.capabilities?.includes("meetings")) return;
    const actions = document.createElement("div");
    actions.className = "director-meeting-actions";
    const reschedule = document.createElement("button");
    reschedule.type = "button";
    reschedule.className = "secondary-button";
    reschedule.textContent = "Reschedule";
    reschedule.addEventListener("click", async () => {
      reschedule.disabled = true;
      try { await window.PortalManagement.manageMeeting(record.id); }
      catch (error) { alert(error.message || "Could not open this one-on-one."); reschedule.disabled = false; }
    });
    actions.append(reschedule);
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary-button";
    cancel.textContent = "Cancel one-on-one";
    cancel.addEventListener("click", async () => {
      if (!window.confirm("Cancel this scheduled one-on-one?")) return;
      cancel.disabled = true;
      try {
        const { error } = await supabaseClient.rpc("portal_mutate", {
          kind: "one_on_one",
          record_id: record.id,
          payload: { status: "canceled" }
        });
        if (error) throw error;
        await refreshDirectorData();
      } catch (error) { alert(error.message || "The one-on-one could not be canceled."); cancel.disabled = false; }
    });
    actions.append(cancel);
    container.append(actions);
    return;
  }
  if (record.status !== "pending") return;
  const actions = document.createElement("div");
  actions.className = "director-meeting-actions";
  for (const [decision, label, className] of [["accept", "Accept", "primary-button"], ["deny", "Deny", "secondary-button"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const result = await supabaseClient.rpc("director_respond_one_on_one", { p_one_on_one_id: record.id, p_decision: decision });
        if (result.error) throw result.error;
        await refreshDirectorData();
      } catch (error) {
        alert(error.message || "The one-on-one request could not be updated.");
        button.disabled = false;
      }
    });
    actions.append(button);
  }
  container.append(actions);
}

function displayDirectorOneOnOnes(
  records
) {

  const container =
    document.getElementById(
      "directorOneOnOnesList"
    );


  if (!container) {
    return;
  }


  container.innerHTML =
    "";


  if (
    !records ||
    records.length === 0
  ) {

    container.innerHTML = `
      <div class="empty-state">
        No upcoming one-on-ones scheduled.
      </div>
    `;

    return;

  }


  records.forEach(
    record => {

      const member =
        record.member;


      const memberName =
        member
          ? `${
              member.preferred_name ||
              member.first_name ||
              "Member"
            } ${
              member.last_name ||
              ""
            }`.trim()
          : "Member";


      const meetingMethod =
        record.meeting_method ===
        "in_person"
          ? "In Person"
          : formatStatus(
              record.meeting_method
            );


      const location =
        record.location_method ||
        "Location TBD";


      const card =
        document.createElement(
          "div"
        );


      card.className =
        "director-upcoming-item";


      card.innerHTML = `
        <div class="director-upcoming-item-main">

          <strong>
            ${escapeHTML(
              memberName
            )}
          </strong>

          <span>
            ${escapeHTML(
              record.status === "pending" ? `Requested: ${formatFullDateTime(record.scheduled_date)}` : formatFullDateTime(record.scheduled_date)
            )}
          </span>

        </div>

        <div class="director-upcoming-item-details">

          <span>
            ${escapeHTML(
              record.status === "pending" ? "Waiting for your response" : meetingMethod
            )}
          </span>

          <span>
            ${escapeHTML(
              location
            )}
          </span>

          <span>
            ${escapeHTML(
              formatStatus(
                record.status
              )
            )}
          </span>

        </div>

      `;

      appendDirectorMeetingActions(card, record);


      container.appendChild(
        card
      );

    }
  );

}

// ==========================================================
// 12I. LOAD DIRECTOR CALENDAR EVENTS
// ==========================================================

async function loadDirectorCalendarEvents(
  cohortId
) {

  if (!cohortId) {
    return [];
  }


  const {
    data: events,
    error
  } =
    await supabaseClient
      .from("meetings")
      .select(`
        id,
        title,
        meeting_type,
        event_type,
        event_category,
        description,
        start_time,
        end_time,
        location,
        location_tbd,
        all_day,
        all_day_start,
        all_day_end,
        dress_code,
        what_to_bring
      `)
      .eq(
        "cohort_id",
        cohortId
      )
      .eq(
        "active",
        true
      )
      .order(
        "start_time",
        {
          ascending: true
        }
      );


  if (error) {

    console.error(
      "Could not load director calendar events:",
      error
    );

    return [];

  }


  const { data: birthdayPeople, error: birthdayError } = await supabaseClient.rpc(
    "portal_cohort_directory",
    { p_cohort_id: cohortId }
  );
  if (birthdayError) {
    console.error("Could not load birthdays for director calendar:", birthdayError);
    currentDirectorCalendarBirthdays = [];
  } else {
    currentDirectorCalendarBirthdays = birthdayPeople || [];
  }

  const directorMeetings = currentDirectorAssignment?.cohort_id === cohortId
    ? await loadDirectorUpcomingOneOnOnes(currentDirectorAssignment.id)
    : [];
  const meetingEvents = directorMeetings.map(record => ({
    id: `one-on-one-${record.id}`,
    one_on_one_id: record.id,
    is_one_on_one: true,
    title: `One-on-one: ${record.member ? `${record.member.preferred_name || record.member.first_name || "Trailblazer"} ${record.member.last_name || ""}`.trim() : "Trailblazer"}`,
    start_time: record.scheduled_date,
    end_time: null,
    location: record.location_method || "Location TBD",
    description: `One-on-one ${record.status}.`,
    meeting_type: "One-on-one",
    event_category: "tb_event",
    all_day: false
  }));
  const birthdayEvents = PortalUtils.upcomingCalendarBirthdays(currentDirectorCalendarBirthdays)
    .map(event => ({
      ...event,
      event_category: "tb_event",
      description: "A Trailblazer birthday.",
      location: "",
      location_tbd: false
    }));
  const invitationEvents=window.PortalMeetings&&currentDirector?.id?await PortalMeetings.calendarEvents('director',currentDirector.id):[];
  currentDirectorCalendarEvents = [...(events || []), ...meetingEvents, ...invitationEvents, ...birthdayEvents];

return currentDirectorCalendarEvents;

}

// ==========================================================
// 12J. DISPLAY DIRECTOR CALENDAR EVENTS
// ==========================================================

function displayDirectorCalendarEvents(
  events
) {

  const container =
    document.getElementById(
      "directorCalendarList"
    );


  if (!container) {
    return;
  }


  container.innerHTML = "";


  if (
    !events ||
    events.length === 0
  ) {

    container.innerHTML = `
      <div class="empty-state">
        No events have been scheduled for this cohort yet.
      </div>
    `;

    return;

  }


  events.forEach(
    event => {

      const eventCard =
        document.createElement(
          "div"
        );


      eventCard.className =
        "director-calendar-event";


      const eventType = event.is_birthday
        ? "Birthday"
        : event.is_one_on_one
        ? "One-on-one"
        : (
        event.event_category ||
        event.event_type ||
        event.meeting_type ||
        "Event");


      const location = event.is_birthday
          ? ""
          : event.location_tbd
          ? "Location TBD"
          : (
              event.location ||
              "Location TBD"
            );


      const description =
        event.description ||
        "No additional details provided.";


      eventCard.innerHTML = `
        <div class="director-calendar-event-header">

  <div>
    <span class="director-calendar-event-type">
      ${escapeHTML(
        formatStatus(
          eventType
        )
      )}
    </span>

    <h3>
      ${escapeHTML(
        event.title
      )}
    </h3>
  </div>


  ${event.is_birthday || event.is_one_on_one ? "" : `<button
    type="button"
    class="secondary-button director-edit-event-button"
    data-event-id="${escapeHTML(
      event.id
    )}"
  >
    Edit Event
  </button>

  <button
  type="button"
  class="secondary-button director-cancel-event-button"
  data-event-id="${escapeHTML(
    event.id
  )}"
>
  Cancel Event
</button>`}



</div>


        <div class="director-calendar-event-details">

          <p>
            ${escapeHTML(
              event.is_birthday
                ? formatBirthday(Number(event.all_day_start.slice(5, 7)), Number(event.all_day_start.slice(8, 10)))
                : formatFullDateTime(event.start_time)
            )}
          </p>

          <p>
            ${escapeHTML(
              location
            )}
          </p>

          <p>
            ${escapeHTML(
              description
            )}
          </p>

        </div>

      `;


      container.appendChild(
        eventCard
      );

      const editButton =
  eventCard.querySelector(
    ".director-edit-event-button"
  );


if (editButton) {

  editButton.addEventListener(
    "click",
    function () {

      openDirectorEventForEditing(
        event.id
      );

    }
  );

}

const cancelButton =
  eventCard.querySelector(
    ".director-cancel-event-button"
  );


if (cancelButton) {

  cancelButton.addEventListener(
    "click",
    async function () {

      const confirmed =
        window.confirm(
          `Cancel "${event.title}"?`
        );


      if (!confirmed) {
        return;
      }


      cancelButton.disabled =
        true;


      const {
        error
      } =
        await supabaseClient.rpc(
          "cancel_calendar_event",
          {
            p_event_id:
              event.id
          }
        );


      if (error) {

        console.error(
          "Could not cancel event:",
          error
        );

        alert(
          `The event could not be canceled: ${error.message}`
        );

        cancelButton.disabled =
          false;

        return;

      }


      const directorCalendarEvents =
        await loadDirectorCalendarEvents(
          currentDirectorCohort.id
        );


      displayDirectorCalendarEvents(
        directorCalendarEvents
      );


      const upcomingEventsCount =
        await loadDirectorUpcomingEventsCount(
          currentDirectorCohort.id
        );


      setText(
        "directorUpcomingEventsCount",
        upcomingEventsCount
      );

    }
  );

}


    }
  );

}

// ==========================================================
// 12K. RENDER DIRECTOR MONTHLY CALENDAR
// ==========================================================

function renderDirectorMonthlyCalendar() {

  if (
    !directorCalendarGrid ||
    !directorCalendarMonthLabel
  ) {
    return;
  }


  directorCalendarGrid.innerHTML =
    "";


  const year =
    directorCalendarCursor.getFullYear();

  const month =
    directorCalendarCursor.getMonth();


  directorCalendarMonthLabel.textContent =
    new Intl.DateTimeFormat(
      "en-US",
      {
        month: "long",
        year: "numeric"
      }
    ).format(
      directorCalendarCursor
    );


  const firstDayOfMonth =
    new Date(
      year,
      month,
      1
    );


  const lastDayOfMonth =
    new Date(
      year,
      month + 1,
      0
    );


  const startingWeekday =
    firstDayOfMonth.getDay();


  const numberOfDays =
    lastDayOfMonth.getDate();


  for (
    let i = 0;
    i < startingWeekday;
    i++
  ) {

    const blankCell =
      document.createElement(
        "div"
      );

    blankCell.className =
      "calendar-day director-calendar-day calendar-day-empty director-calendar-day-empty";

    directorCalendarGrid.appendChild(
      blankCell
    );

  }


  for (
    let day = 1;
    day <= numberOfDays;
    day++
  ) {

    const dayCell =
      document.createElement(
        "div"
      );


    dayCell.className =
      "calendar-day director-calendar-day";

    const today = new Date();

    if (
      today.getFullYear() === year &&
      today.getMonth() === month &&
      today.getDate() === day
    ) {
      dayCell.classList.add("calendar-today");
    }


    const dayNumber =
      document.createElement(
        "div"
      );


    dayNumber.className =
      "calendar-day-number director-calendar-day-number";


    dayNumber.textContent =
      day;


    dayCell.appendChild(
      dayNumber
    );

  const eventsForDay = currentDirectorCalendarEvents.filter(event =>
      !event.is_birthday && PortalUtils.occursOnDate(event.start_time, event.end_time,
        new Date(year, month, day), event.all_day_start, event.all_day_end));
    const birthdayEventsForDay = PortalUtils.calendarBirthdays(currentDirectorCalendarBirthdays, year, 1)
      .filter(event => PortalUtils.occursOnDate(null, null, new Date(year, month, day), event.all_day_start, event.all_day_end))
      .map(event => ({ ...event, event_category: "tb_event", description: "A Trailblazer birthday." }));
    eventsForDay.push(...birthdayEventsForDay);


eventsForDay.forEach(
  event => {

    const eventButton =
      document.createElement(
        "button"
      );


    eventButton.type =
      "button";


    const eventCategory =
      event.event_category === "nsbe_event"
        ? "nsbe_event"
        : "tb_event";

    eventButton.className =
      `calendar-event director-calendar-event-button calendar-event-${eventCategory}`;


    eventButton.innerHTML = `
      <strong>${escapeHTML(event.is_one_on_one ? "One-on-one" : getEventCategoryLabel(eventCategory))}</strong>
      <span>${escapeHTML(event.title)}</span>
      <small>${escapeHTML(event.all_day ? "All day" : formatCalendarTime(event.start_time))}</small>
    `;


    eventButton.addEventListener(
      "click",
      function () {

        if (event.is_birthday) {
          window.alert(`${event.title} — ${formatBirthday(Number(event.all_day_start.slice(5, 7)), Number(event.all_day_start.slice(8, 10)))}`);
        } else if (event.is_one_on_one) {
          window.alert(`${event.title}\n${formatFullDateTime(event.start_time)}\n${event.location || "Location TBD"}`);
        } else {
          openDirectorEventForEditing(event.id);
        }

      }
    );


    dayCell.appendChild(
      eventButton
    );

  }
);

    directorCalendarGrid.appendChild(
      dayCell
    );

  }

}

// ==========================================================
// 12K. DIRECTOR CREATE EVENT FORM
// ==========================================================

function openDirectorEventForm() {

  if (!directorCreateEventForm) {
    return;
  }

  directorCreateEventForm.style.display =
    "block";

  directorCreateEventForm.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

}

function openDirectorOneOnOneForm() {

  if (!directorScheduleOneOnOneForm) {
    return;
  }

  directorScheduleOneOnOneForm.style.display =
    "block";

  directorScheduleOneOnOneForm.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

}


function closeDirectorOneOnOneForm() {

  if (!directorScheduleOneOnOneForm) {
    return;
  }

  directorScheduleOneOnOneForm.style.display =
    "none";

  if (directorOneOnOneForm) {
    directorOneOnOneForm.reset();
  }

}

function closeDirectorEventForm() {

  if (!directorCreateEventForm) {
    return;
  }

  directorCreateEventForm.style.display =
    "none";

editingDirectorEventId =
  null;

  if (directorEventForm) {
    directorEventForm.reset();
  }

  setText(
    "directorEventMessage",
    ""
  );

}

function formatDateTimeLocalValue(
  dateValue
) {

  if (!dateValue) {
    return "";
  }

  const date =
    new Date(dateValue);

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      date.getDate()
    ).padStart(
      2,
      "0"
    );

  const hours =
    String(
      date.getHours()
    ).padStart(
      2,
      "0"
    );

  const minutes =
    String(
      date.getMinutes()
    ).padStart(
      2,
      "0"
    );

  return (
    `${year}-${month}-${day}` +
    `T${hours}:${minutes}`
  );

}

function openDirectorEventForEditing(
  eventId
) {

  const event =
    currentDirectorCalendarEvents.find(
      calendarEvent =>
        calendarEvent.id ===
        eventId
    );


  if (!event) {

    console.error(
      "Could not find event:",
      eventId
    );

    return;

  }


  editingDirectorEventId =
    event.id;


  document.getElementById(
    "directorEventTitle"
  ).value =
    event.title || "";


  document.getElementById(
    "directorEventCategory"
  ).value =
    event.event_category ===
      "nsbe_event"
      ? "nsbe"
      : "trailblazers";


  document.getElementById(
    "directorEventMeetingType"
  ).value =
    event.meeting_type || "";


  document.getElementById(
    "directorEventAllDay"
  ).checked =
    event.all_day === true;


  document.getElementById(
    "directorEventStart"
  ).value =
    formatDateTimeLocalValue(
      event.start_time
    );


  document.getElementById(
    "directorEventEnd"
  ).value =
    event.end_time
      ? formatDateTimeLocalValue(
          event.end_time
        )
      : "";


  document.getElementById(
    "directorEventLocation"
  ).value =
    event.location || "";


  document.getElementById(
    "directorEventLocationTBD"
  ).checked =
    event.location_tbd === true;


  document.getElementById(
    "directorEventDressCode"
  ).value =
    event.dress_code || "";


  document.getElementById(
    "directorEventBring"
  ).value =
    event.what_to_bring || "";


  document.getElementById(
    "directorEventDescription"
  ).value =
    event.description || "";


  openDirectorEventForm();

}


// ==========================================================
// 13. DISPLAY MEMBER PROFILE
// ==========================================================

function displayCurrentMember(
  member,
  cohort
) {

  if (!member) {
    return;
  }


  const preferredName =
    member.preferred_name ||
    member.first_name ||
    "Member";


  const fullName =
    `${
      member.first_name ||
      ""
    } ${
      member.last_name ||
      ""
    }`.trim();


  const initials =
    getInitials(
      member.first_name,
      member.last_name
    );


  setText(
    "homePreferredName",
    preferredName
  );


  setText(
    "homeAvatar",
    initials
  );


  setText(
    "profileAvatar",
    initials
  );


  setText(
    "profileFullName",
    fullName
  );


  setText(
    "profileBannerMajor",
    member.major ||
      "Major not listed"
  );


  setText(
    "profileBannerGradYear",
    member.graduation_year
  );


  setText(
    "profileMajor",
    member.major
  );


  setText(
    "profileMinor",
    member.minor
  );


  setText(
    "profileCollege",
    member.college
  );


  setText(
    "profileGradYear",
    member.graduation_year
  );


  setText(
    "profileEmail",
    member.uf_email
  );


  setText(
    "profileBirthday",
    formatBirthday(
      member.birthday_month,
      member.birthday_day
    )
  );


  setText(
    "profileOrganizationsLeadership",
    [member.organizations, member.leadership_roles].filter(Boolean).join(" · ")
  );


  setText(
    "profileInterests",
    [member.career_interests, member.academic_interests, member.research_interests].filter(Boolean).join(" · ")
  );


  const status =
    member.program_status
      ? formatStatus(
          member.program_status
        )
      : "Active";


  setText(
    "profileStatusTag",
    status
  );


  if (cohort) {

    const cohortName =
      cohort.name ||
      `Class ${
        cohort.class_number
      }`;


    setText(
      "sidebarCohort",
      cohortName
    );


    setText(
      "heroCohort",
      cohortName
        .toUpperCase()
    );


    setText(
      "profileCohortTag",
      cohortName
    );


    setText(
      "profileCohort",
      cohortName
    );

  }

}


// ==========================================================
// 14. POINT DATA
// ==========================================================

async function loadPointData(
  memberId
) {

  const {
    data,
    error
  } =
    await supabaseClient
      .from(
        "point_submissions"
      )
      .select(`
        id,
        activity_name,
        activity_date,
        description,
        points_requested,
        points_awarded,
        status,
        submitted_at,
        director_note,
        reviewed_at,
        reviewed_by,
        reviewed_by_user_id,
        reviewer_name,
        director_assigned,
        removed_at,
        point_rule_id,
        occurrence_count,
        evidence_path,
        evidence_drive_url
      `)
      .eq(
        "member_id",
        memberId
      )
      .order(
        "submitted_at",
        {
          ascending: false
        }
      );


  if (error) {

    console.error(
      "Could not load points:",
      error
    );

    return [];

  }


  return data || [];

}


// ==========================================================
// 15. POINT CALCULATIONS
// ==========================================================

function calculateApprovedPoints(
  submissions
) {

  return submissions
    .filter(
      submission =>
        submission.status ===
        "approved"
    )
    .reduce(
      (
        total,
        submission
      ) =>
        total +
        Number(
          submission.points_awarded ||
          0
        ),
      0
    );

}


// ==========================================================
// 16. DISPLAY POINT DATA
// ==========================================================

function displayPointData(
  submissions
) {

  const total =
    calculateApprovedPoints(
      submissions
    );


  const remaining =
    Math.max(
      POINT_REQUIREMENT -
        total,
      0
    );


  document
    .querySelectorAll(
      ".points-total"
    )
    .forEach(
      element => {

        element.textContent =
          `${total} / ${POINT_REQUIREMENT}`;

      }
    );


  document
    .querySelectorAll(
      ".points-remaining"
    )
    .forEach(
      element => {

        element.textContent =
          remaining === 0
            ? "Point requirement completed"
            : `${remaining} points remaining`;

      }
    );


  const percentage =
    Math.min(
      (
        total /
        POINT_REQUIREMENT
      ) * 100,
      100
    );


  document
    .querySelectorAll(
      ".points-progress"
    )
    .forEach(
      bar => {

        bar.style.width =
          `${percentage}%`;

      }
    );


  displayPointHistory(
    submissions
  );

}


// ==========================================================
// 17. POINT HISTORY
// ==========================================================

function displayPointHistory(submissions) {
  PortalInventory.memberPoints(submissions);
}

// ==========================================================
// 18. ONE-ON-ONE DATA
// ==========================================================

async function loadOneOnOneData(
  memberId
) {

  const {
    data: oneOnOnes,
    error: oneOnOneError
  } =
    await supabaseClient
      .from(
        "one_on_ones"
      )
      .select(`
        id,
        director_id,
        director_assignment_id,
        status,
        scheduled_date,
        completed_date,
        scheduled_by_user_id,
        member_accepted_at,
        location_method,
        meeting_method
      `)
      .eq(
        "member_id",
        memberId
      );


  if (oneOnOneError) {

    console.error(
      "Could not load one-on-ones:",
      oneOnOneError
    );

    return [];

  }


  const {
    data: directors,
    error: directorError
  } =
    await supabaseClient
      .from(
        "directors"
      )
      .select(`
        id,
        first_name,
        last_name,
        title,
        role,
        active
      ` );


  if (directorError) {

    console.error(
      "Could not load directors:",
      directorError
    );

    return [];

  }


  const {data: assigned, error: assignmentError} = await supabaseClient.from('director_assignments').select('*').eq('cohort_id',currentMember.cohort_id);
  if(assignmentError) throw new Error(assignmentError.message);
  const today=new Date().toLocaleDateString('en-CA');
  const requiredIds=new Set((assigned||[]).filter(a=>a.active&&(!a.start_date||a.start_date<=today)&&(!a.end_date||a.end_date>=today)).map(a=>a.director_id));
  for(const director of directors||[]) director.active=director.active&&requiredIds.has(director.id);
  const directorMap =
    new Map(
      (
        directors ||
        []
      )
        .map(
          director => [
            director.id,
            director
          ]
        )
    );


  return (
    oneOnOnes ||
    []
  )
    .map(
      record => ({
        ...record,

        director:
          directorMap.get(
            record.director_id
          ) ||
          null
      })
    )
    .filter(
      record =>
        record.director
    )
    .sort(
      (
        first,
        second
      ) => {

        const firstName =
          `${first.director.first_name} ${first.director.last_name}`;


        const secondName =
          `${second.director.first_name} ${second.director.last_name}`;


        return firstName.localeCompare(
          secondName
        );

      }
    );

}


// ==========================================================
// 19. DISPLAY ONE-ON-ONE PROGRESS
// ==========================================================

function displayOneOnOneData(
  records
) {
  const snapshot=currentMember?.program_status==='archived'?currentMember.completion_snapshot:null;
  const completed =
    snapshot?.completed ?? records.filter(
      record =>
        record.director?.active && record.status ===
        "completed" && record.completed_date?.slice(0,10)>=PortalCompletion.termStart()
    ).length;


  const total =
    snapshot?.required ?? records.filter(record=>record.director?.active).length;


  document
    .querySelectorAll(
      ".one-on-one-total"
    )
    .forEach(
      element => {

        element.textContent =
          `${completed} / ${total}`;

      }
    );


  document
    .querySelectorAll(
      ".one-on-one-remaining"
    )
    .forEach(
      element => {

        const remaining =
          Math.max(
            total -
              completed,
            0
          );


        element.textContent =
          total === 0 ? "No one-on-ones assigned yet" : remaining === 0
            ? "All one-on-ones completed"
            : `${remaining} remaining`;

      }
    );


  const percentage =
    total > 0
      ? (
          completed /
          total
        ) * 100
      : 0;


  document
    .querySelectorAll(
      ".one-on-one-progress"
    )
    .forEach(
      bar => {

        bar.style.width =
          `${percentage}%`;

      }
    );


  renderOneOnOneCards(
    records
  );


  populateOneOnOneSelect(
    records
  );

}


// ==========================================================
// 20. ONE-ON-ONE DIRECTOR CARDS
// ==========================================================

function renderOneOnOneCards(
  records
) {

  const grid =
    document.getElementById(
      "directorGrid"
    );


  if (!grid) {
    return;
  }


  grid.innerHTML =
    "";


  if (
    records.length === 0
  ) {

    grid.innerHTML = `
      <div class="empty-state">
        No director one-on-ones are assigned yet.
      </div>
    `;


    return;

  }


  records.forEach(
    record => {

      const director =
        record.director;


      const card =
        document.createElement(
          "article"
        );


      card.className =
        "director-card";


      const avatar =
        document.createElement(
          "div"
        );


      avatar.className =
        "director-avatar";


      avatar.textContent =
        getInitials(
          director.first_name,
          director.last_name
        );


      const name =
        document.createElement(
          "h3"
        );


      name.textContent =
        `${
          director.first_name
        } ${
          director.last_name
        }`;


      const role =
        document.createElement(
          "p"
        );


      role.className =
        "director-role";


      role.textContent =
        director.title ||
        director.role ||
        "Trailblazers Director";


      const status =
        document.createElement(
          "span"
        );


      status.className =
        `one-on-one-status ${
          record.status ||
          "not_scheduled"
        }`;


      status.textContent =
        formatStatus(
          record.status
        );


      card.appendChild(
        avatar
      );


      card.appendChild(
        name
      );


      card.appendChild(
        role
      );


      card.appendChild(
        status
      );


      if (["scheduled", "pending"].includes(record.status) && record.scheduled_date) {

        const scheduledInfo =
          document.createElement(
            "p"
          );


        scheduledInfo.className =
          "director-meeting-detail";


        scheduledInfo.textContent =
          formatFullDateTime(
            record.scheduled_date
          );


        card.appendChild(
          scheduledInfo
        );


        const locationInfo =
          document.createElement(
            "p"
          );


        locationInfo.className =
          "director-meeting-detail";


        locationInfo.textContent =
          record.location_method ||
          "Location TBD";


        card.appendChild(
          locationInfo
        );

      }


      if (
        record.status ===
          "completed" &&
        record.completed_date
      ) {

        const completedInfo =
          document.createElement(
            "p"
          );


        completedInfo.className =
          "director-meeting-detail";


        completedInfo.textContent =
          `Completed ${
            formatShortDate(
              record.completed_date
            )
          }`;


        card.appendChild(
          completedInfo
        );

      }


      if (record.status !== "completed" && record.status !== "completion_pending" && record.director.active) {

        const button =
          document.createElement(
            "button"
          );


        button.className =
          "secondary-button";


        button.type =
          "button";


        button.textContent = record.status === "scheduled" ? "Reschedule" : record.status === "pending" ? "Change request" : record.status === "denied" || record.status === "canceled" ? "Request another time" : "Schedule";


        button.style.marginTop =
          "16px";


        button.addEventListener(
          "click",
          function () {

            openScheduleModal(
              record.id
            );

          }
        );


        card.appendChild(
          button
        );

        if (record.status === "scheduled" || record.status === "pending") {
          const cancelButton = document.createElement("button");
          cancelButton.type = "button";
          cancelButton.className = "secondary-button";
          cancelButton.textContent = record.status === "pending" ? "Cancel request" : "Cancel meeting";
          cancelButton.style.marginTop = "8px";
          cancelButton.addEventListener("click", async () => {
            cancelButton.disabled = true;
            try {
              const result = await supabaseClient.rpc("member_cancel_one_on_one", { p_one_on_one_id: record.id });
              if (result.error) throw result.error;
              await refreshMemberData();
            } catch (error) {
              alert(error.message || "The one-on-one could not be canceled.");
              cancelButton.disabled = false;
            }
          });
          card.appendChild(cancelButton);
        }

      }

      if(record.status==='scheduled'&&!record.member_accepted_at&&record.scheduled_by_user_id!==currentMember?.auth_user_id&&new Date(record.scheduled_date)>new Date()){
        const accept=document.createElement('button');accept.type='button';accept.className='primary-button';accept.textContent='Accept invitation';
        accept.onclick=async()=>{accept.disabled=true;try{const result=await supabaseClient.rpc('portal_respond_legacy_meeting',{record_id:record.id,decision:'accept'});if(result.error)throw result.error;await refreshMemberData();}catch(e){alert(e.message);accept.disabled=false;}};
        card.append(accept);
      }

      grid.appendChild(
        card
      );

    }
  );

}


// ==========================================================
// 21. STRIKES
// ==========================================================

async function loadStrikeData(
  memberId
) {

  const {
    data,
    error
  } =
    await supabaseClient
      .from(
        "strikes"
      )
      .select(`
        id,
        reason,
        status,
        issued_at,
        resolved_at,
        resolution_note
      `)
      .eq(
        "member_id",
        memberId
      )
      .order(
        "issued_at",
        {
          ascending: false
        }
      );


  if (error) {

    console.error(
      "Could not load strikes:",
      error
    );

    return [];

  }

  return data || [];

}


function displayStrikeData(
  strikes
) {

  const active =
    strikes.filter(
      strike =>
        strike.status ===
        "active"
    ).length;


  document
    .querySelectorAll(
      ".strike-total"
    )
    .forEach(
      element => {

        element.textContent =
          active;

      }
    );

}


// ==========================================================
// 22. PORTAL EVENTS
// ==========================================================

async function loadPortalEvents(
  cohortId
) {

  const {
    data,
    error
  } =
    await supabaseClient
      .from(
        "meetings"
      )
      .select(`
        id,
        cohort_id,
        title,
        meeting_type,
        description,
        start_time,
        end_time,
        location,
        dress_code,
        what_to_bring,
        active,
        event_category,
        location_tbd,
        all_day,
        all_day_start,
        all_day_end
      `)
      .eq(
        "active",
        true
      )
      .order(
        "start_time",
        {
          ascending: true
        }
      );


  if (error) {

    console.error(
      "Could not load events:",
      error
    );

    return [];

  }


  // Events with no cohort are treated as global.
  // Cohort-specific events only display to that cohort.

  return (
    data ||
    []
  ).filter(
    event =>
      !event.cohort_id ||
      event.cohort_id ===
        cohortId
  );

}

async function loadPortalCohortDirectory(cohortId) {
  if (!cohortId || currentMember?.program_status !== "active") return [];
  const { data, error } = await supabaseClient.rpc("portal_cohort_directory", { p_cohort_id: cohortId });
  if (error) {
    console.error("Could not load cohort directory:", error);
    return [];
  }
  return data || [];
}

function displayMemberCohort() {
  const grid = document.getElementById("cohortDirectoryGrid");
  if (!grid || !currentMember || currentMember.program_status !== "active") return;
  const query = (document.getElementById("cohortDirectorySearch")?.value || "").trim().toLowerCase();
  const rows = currentCohortDirectory.filter(person => person.member_id !== currentMember.id &&
    [person.display_name,person.major,person.minor,person.college,String(person.graduation_year||""),person.email].filter(Boolean).join(" ").toLowerCase().includes(query))
    .sort((a,b)=>a.display_name.localeCompare(b.display_name,undefined,{sensitivity:"base"})*(cohortDirectorySortDirection==="asc"?1:-1));
  grid.replaceChildren();
  if (!rows.length) {
    grid.innerHTML = '<div class="empty-state">No other Trailblazers match your search.</div>';
    return;
  }
  for (const person of rows) {
    const card = document.createElement("article");
    card.className = "director-member-card";
    const details = [person.major,person.minor,person.college,person.graduation_year&&`Class of ${person.graduation_year}`].filter(Boolean);
    card.innerHTML = `<div class="director-avatar">${escapeHTML(getInitials(person.display_name.split(" ")[0],person.display_name.split(" ").slice(1).join(" ")))}</div><h2>${escapeHTML(person.display_name)}</h2>${details.length?`<p>${escapeHTML(details.join(" · "))}</p>`:'<p>Academic details not provided.</p>'}${person.email?`<p class="member-meta"><a href="mailto:${escapeHTML(person.email)}">${escapeHTML(person.email)}</a></p>`:""}${person.linkedin_url?`<a class="secondary-button" href="${escapeHTML(person.linkedin_url)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>`:""}`;
    grid.append(card);
  }
}


// ==========================================================
// 23. BUILD UNIFIED CALENDAR
// ==========================================================

function buildCalendarItems(
  portalEvents,
  oneOnOnes,
  cohortPeople = []
) {

  const eventItems =
    portalEvents
      .filter(
        event =>
          event.start_time || (event.all_day && event.all_day_start)
      )
      .map(
        event => ({

          id:
            `event-${event.id}`,

          sourceId:
            event.id,

          category:
            event.event_category ||
            "tb_event",

          title:
            event.title ||
            "Event",

          start:
            new Date(
              event.all_day && event.all_day_start ? `${event.all_day_start}T00:00:00` : event.start_time
            ),

          end:
            event.end_time
              ? new Date(
                  event.end_time
                )
              : null,

          location:
            event.location_tbd
              ? "Location TBD"
              : (
                  event.location ||
                  "Location TBD"
                ),

          description:
            event.description ||
            "",

          meetingType:
            event.meeting_type ||
            "",

          dressCode:
            event.dress_code ||
            "",

          whatToBring:
            event.what_to_bring ||
            "",

          allDayStart: event.all_day_start,
          allDayEnd: event.all_day_end,
          allDay:
            event.all_day ||
            false

        })
      );


  const oneOnOneItems =
    oneOnOnes
      .filter(
        record =>
          record.status ===
            "scheduled" &&
          record.scheduled_date
      )
      .map(
        record => ({

          id:
            `one-on-one-${
              record.id
            }`,

          sourceId:
            record.id,

          category:
            "one_on_one",

          title:
            `1-on-1 with ${
              record.director.first_name
            } ${
              record.director.last_name
            }`,

          start:
            new Date(
              record.scheduled_date
            ),

          end:
            null,

          location:
            record.location_method ||
            "Location TBD",

          description:
            "In-person Trailblazers one-on-one.",

          meetingType:
            "In Person",

          dressCode:
            "",

          whatToBring:
            "",

          allDay:
            false

        })
      );

  const birthdayItems = PortalUtils.calendarBirthdays(cohortPeople, new Date().getFullYear(), 2).map(event => ({
    id: event.id,
    sourceId: event.member_id,
    category: "tb_event",
    title: event.title,
    start: new Date(`${event.all_day_start}T00:00:00`),
    end: null,
    location: "",
    description: "A Trailblazer birthday.",
    meetingType: "Birthday",
    dressCode: "",
    whatToBring: "",
    allDayStart: event.all_day_start,
    allDayEnd: event.all_day_end,
    allDay: true,
    isBirthday: true
  }));


  return [
    ...eventItems,
    ...oneOnOneItems,
    ...birthdayItems
  ]
    .filter(
      item =>
        !Number.isNaN(
          item.start.getTime()
        )
    )
    .sort(
      (
        first,
        second
      ) =>
        first.start -
        second.start
    );

}


// ==========================================================
// 24. NEXT UPCOMING EVENT
// ==========================================================

function displayNextEvent(
  items
) {

  const now =
    new Date();


  const nextEvent =
    [...items].sort((a, b) => a.start - b.start).find(
      item =>
        item.start >=
        now || (item.allDay && new Date(`${item.allDayEnd || item.allDayStart}T23:59:59`) >= now)
    );


  if (!nextEvent) {

    setText(
      "nextEventCategory",
      "UPCOMING"
    );


    setText(
      "nextEventTitle",
      "No upcoming events"
    );


    setText(
      "nextEventDate",
      "Check back for updates."
    );


    setText(
      "nextEventLocation",
      "—"
    );


    return;

  }


  setText(
    "nextEventCategory",
    getEventCategoryLabel(
      nextEvent.category
    ).toUpperCase()
  );


  setText(
    "nextEventTitle",
    nextEvent.title
  );


  setText(
    "nextEventDate",
    nextEvent.allDay ? `${nextEvent.start.toLocaleDateString([], { dateStyle: 'long' })} · All day` : formatFullDateTime(nextEvent.start)
  );


  setText(
    "nextEventLocation",
    nextEvent.location ||
    "Location TBD"
  );

}


// ==========================================================
// 25. MONTHLY CALENDAR
// ==========================================================

function renderCalendar() {

  const title =
    document.getElementById(
      "calendarMonthTitle"
    );


  const grid =
    document.getElementById(
      "calendarGrid"
    );


  if (
    !title ||
    !grid
  ) {

    return;

  }


  title.textContent =
    calendarCursor
      .toLocaleDateString(
        "en-US",
        {
          month: "long",
          year: "numeric"
        }
      );


  grid.innerHTML =
    "";


  const year =
    calendarCursor
      .getFullYear();


  const month =
    calendarCursor
      .getMonth();


  const firstDay =
    new Date(
      year,
      month,
      1
    );


  const lastDay =
    new Date(
      year,
      month + 1,
      0
    );


  const numberOfDays =
    lastDay.getDate();


  const startingWeekday =
    firstDay.getDay();


  // Empty cells before the first day.

  for (
    let index = 0;
    index <
    startingWeekday;
    index++
  ) {

    const emptyCell =
      document.createElement(
        "div"
      );


    emptyCell.className =
      "calendar-day calendar-day-empty";


    grid.appendChild(
      emptyCell
    );

  }


  // Actual month days.

  for (
    let day = 1;
    day <=
    numberOfDays;
    day++
  ) {

    const cellDate =
      new Date(
        year,
        month,
        day
      );


    const cell =
      document.createElement(
        "div"
      );


    cell.className =
      "calendar-day";


    const today =
      new Date();


    if (
      cellDate.getFullYear() ===
        today.getFullYear() &&
      cellDate.getMonth() ===
        today.getMonth() &&
      cellDate.getDate() ===
        today.getDate()
    ) {

      cell.classList.add(
        "calendar-today"
      );

    }


    const dayNumber =
      document.createElement(
        "span"
      );


    dayNumber.className =
      "calendar-day-number";


    dayNumber.textContent =
      day;


    cell.appendChild(
      dayNumber
    );


    const birthdayItems = PortalUtils.calendarBirthdays(currentCohortDirectory, year, 1).map(event => ({
      ...event,start:new Date(`${event.all_day_start}T00:00:00`),end:null,allDayStart:event.all_day_start,allDayEnd:event.all_day_end,allDay:true,category:"tb_event",isBirthday:true,location:""
    }));
    const dayItems = [...currentCalendarItems.filter(item => !item.isBirthday), ...birthdayItems].filter(item =>
      PortalUtils.occursOnDate(item.start, item.end, cellDate, item.allDayStart, item.allDayEnd));


    dayItems.forEach(
      item => {

        const eventButton =
          document.createElement(
            "button"
          );


        eventButton.type =
          "button";


        eventButton.className =
          `calendar-event calendar-event-${
            item.category
          }`;


        const category =
          document.createElement(
            "strong"
          );


        category.textContent =
          getEventCategoryLabel(
            item.category
          );


        const eventTitle =
          document.createElement(
            "span"
          );


        eventTitle.textContent =
          item.title;


        const eventTime =
          document.createElement(
            "small"
          );


        eventTime.textContent =
          item.allDay
            ? "All day"
            : formatCalendarTime(
                item.start
              );


        eventButton.appendChild(
          category
        );


        eventButton.appendChild(
          eventTitle
        );


        eventButton.appendChild(
          eventTime
        );


        eventButton.addEventListener(
          "click",
          function () {

            openEventDetails(
              item
            );

          }
        );


        cell.appendChild(
          eventButton
        );

      }
    );


    grid.appendChild(
      cell
    );

  }

}


// ==========================================================
// 26. EVENT DETAILS MODAL
// ==========================================================

function openEventDetails(
  item
) {

  setText(
    "eventDetailCategory",
    getEventCategoryLabel(
      item.category
    )
  );


  setText(
    "eventDetailTitle",
    item.title
  );


  setText(
    "eventDetailDate",
    item.allDay
      ? formatShortDate(
          item.start
        )
      : formatFullDateTime(
          item.start
        )
  );


  setText(
    "eventDetailLocation",
    item.location ||
    "Location TBD"
  );


  let description =
    item.description ||
    "No additional details.";


  if (
    item.dressCode
  ) {

    description +=
      ` Dress code: ${
        item.dressCode
      }.`;

  }


  if (
    item.whatToBring
  ) {

    description +=
      ` What to bring: ${
        item.whatToBring
      }.`;

  }


  setText(
    "eventDetailDescription",
    description
  );


  const modal =
    document.getElementById(
      "eventDetailsModal"
    );


  if (modal) {

    modal.classList.add(
      "modal-open"
    );

  }

}


function closeEventDetails() {

  const modal =
    document.getElementById(
      "eventDetailsModal"
    );


  if (modal) {

    modal.classList.remove(
      "modal-open"
    );

  }

}


// ==========================================================
// 27. ONE-ON-ONE SCHEDULING DROPDOWN
// ==========================================================

function populateOneOnOneSelect(
  records
) {

  const select =
    document.getElementById(
      "scheduleDirector"
    );


  if (!select) {
    return;
  }


  select.innerHTML = `
    <option value="">
      Select a director
    </option>
  `;


  records
    .filter(
      record =>
        record.status !== "completed" && record.status !== "canceled" && record.director.active
    )
    .forEach(
      record => {

        const option =
          document.createElement(
            "option"
          );


        option.value =
          record.id;


        const title =
          record.director.title ||
          record.director.role ||
          "Director";


        option.textContent =
          `${
            record.director.first_name
          } ${
            record.director.last_name
          } — ${title}`;


        select.appendChild(
          option
        );

      }
    );

}


// ==========================================================
// 28. OPEN / CLOSE SCHEDULE MODAL
// ==========================================================

function openScheduleModal(
  oneOnOneId = ""
) {
  if(!oneOnOneId&&window.PortalMeetings)return PortalMeetings.open(document.querySelector('#oneOnOnesPage .meeting-inbox'));

  const modal =
    document.getElementById(
      "scheduleModal"
    );


  const select =
    document.getElementById(
      "scheduleDirector"
    );


  if (
    oneOnOneId &&
    select
  ) {

    select.value =
      oneOnOneId;

  }


  if (modal) {

    modal.classList.add(
      "modal-open"
    );

  }

}


function closeScheduleModal() {

  const modal =
    document.getElementById(
      "scheduleModal"
    );


  if (modal) {

    modal.classList.remove(
      "modal-open"
    );

  }

}


// Make available to HTML onclick buttons.

window.openScheduleModal =
  openScheduleModal;


// ==========================================================
// 29. SUBMIT MEMBER ONE-ON-ONE SCHEDULE
// ==========================================================

async function submitOneOnOneSchedule(
  event
) {

  event.preventDefault();


  const directorSelect =
    document.getElementById(
      "scheduleDirector"
    );


  const dateInput =
    document.getElementById(
      "scheduleDateTime"
    );


  const locationInput =
    document.getElementById(
      "scheduleLocation"
    );


  if (
    !directorSelect ||
    !dateInput ||
    !locationInput
  ) {

    console.error(
      "One-on-one scheduling fields are missing."
    );

    return;

  }


  const oneOnOneId =
    directorSelect.value;


  const dateTime =
    dateInput.value;


  const location =
    locationInput.value
      .trim();


  if (
    !oneOnOneId ||
    !dateTime
  ) {

    alert(
      "Please select a director, date, and time."
    );


    return;

  }


  const scheduledDate =
    new Date(
      dateTime
    );


  if (
    Number.isNaN(
      scheduledDate.getTime()
    )
  ) {

    alert(
      "Please enter a valid date and time."
    );


    return;

  }


  if (
    scheduledDate <=
    new Date()
  ) {

    alert(
      "Please choose a future date and time."
    );


    return;

  }


  const submitButton =
    document.querySelector(
      "#scheduleForm button[type='submit']"
    );


  if (submitButton) {

    submitButton.disabled =
      true;


    submitButton.textContent =
      "Saving...";

  }


  const {
    error
  } =
    await supabaseClient.rpc(
      "schedule_my_one_on_one",
      {

        p_one_on_one_id:
          oneOnOneId,

        p_scheduled_date:
          scheduledDate
            .toISOString(),

        // All Trailblazers one-on-ones
        // are in person.

        p_meeting_method:
          "in_person",

        p_location_method:
          location ||
          null

      }
    );


  if (submitButton) {

    submitButton.disabled =
      false;


    submitButton.textContent =
      "Add to Calendar";

  }


  if (error) {

    console.error(
      "Scheduling error:",
      error
    );


    alert(
      error.message ||
      "The one-on-one could not be scheduled."
    );


    return;

  }


  closeScheduleModal();


  const form =
    document.getElementById(
      "scheduleForm"
    );


  if (form) {

    form.reset();

  }


  await refreshMemberData();


  showPage(
    "calendar"
  );

}


// ==========================================================
// 30. ANNOUNCEMENTS
// ==========================================================

async function loadAnnouncements(
  cohortId
) {

  let query =
    supabaseClient
      .from("announcements")
      .select(`
        id,
        title,
        body,
        attachment_path,
        attachment_name,
        publish_at,
        pinned,
        expires_at,
        created_at,
        active
      `)
      .eq("active", true)
      .eq("audience", "members");

  if (cohortId) {
    query = query.or(
      `cohort_id.is.null,cohort_id.eq.${cohortId}`
    );
  }

  const { data, error } =
    await query.order("pinned", { ascending: false }).order("created_at", { ascending: false });


  if (error) {

    console.error(
      "Could not load announcements:",
      error
    );

    return [];

  }


  const now =
    new Date();


  return (
    data ||
    []
  ).filter(
    announcement => {

      if (
        announcement.publish_at
      ) {

        const publishDate =
          new Date(
            announcement.publish_at
          );


        if (
          publishDate >
          now
        ) {

          return false;

        }

      }


      if (
        announcement.expires_at
      ) {

        const expires =
          new Date(
            announcement.expires_at
          );


        if (
          expires <
          now
        ) {

          return false;

        }

      }


      return true;

    }
  );

}


// ==========================================================
// 31. DISPLAY ANNOUNCEMENTS
// ==========================================================

function displayAnnouncements(
  announcements
) {

  const latest =
    announcements[0];


  if (!latest) {

    setText(
      "homeAnnouncementTitle",
      "No announcements yet"
    );


    setText(
      "homeAnnouncementBody",
      "New Trailblazers updates will appear here."
    );

    const homeFlyer = document.getElementById("homeAnnouncementFlyer");
    if (homeFlyer) { homeFlyer.hidden = true; homeFlyer.removeAttribute("href"); }

  } else {

    setText(
      "homeAnnouncementTitle",
      latest.title
    );


    setText(
      "homeAnnouncementBody",
      latest.body
    );

    const homeFlyer = document.getElementById("homeAnnouncementFlyer");
    if (homeFlyer) {
      homeFlyer.hidden = !latest.attachment_path;
      if (latest.attachment_path) {
        homeFlyer.href = supabaseClient.storage.from("trailblazers-resources").getPublicUrl(latest.attachment_path).data.publicUrl;
        homeFlyer.textContent = latest.attachment_name ? `View flyer: ${latest.attachment_name}` : "View attached flyer";
      } else homeFlyer.removeAttribute("href");
    }

  }


  const container =
    document.getElementById(
      "nsbeAnnouncementList"
    );


  if (!container) {
    return;
  }


  container.innerHTML =
    "";


  if (
    announcements.length === 0
  ) {

    container.innerHTML = `
      <div class="empty-state">
        No active announcements right now.
      </div>
    `;


    return;

  }


  announcements
    .slice(
      0,
      6
    )
    .forEach(
      announcement => {

        const card =
          document.createElement(
            "article"
          );


        card.className =
          "announcement-card";


        const title =
          document.createElement(
            "h3"
          );


        title.textContent =
          announcement.title;


        const body =
          document.createElement(
            "p"
          );


        body.textContent =
          announcement.body;

        if (announcement.attachment_path) {
          const flyer = document.createElement("a");
          flyer.className = "announcement-flyer-link";
          flyer.href = supabaseClient.storage.from("trailblazers-resources").getPublicUrl(announcement.attachment_path).data.publicUrl;
          flyer.target = "_blank";
          flyer.rel = "noopener noreferrer";
          flyer.textContent = announcement.attachment_name ? `View flyer: ${announcement.attachment_name}` : "View attached flyer";
          card.appendChild(title);
          card.appendChild(body);
          card.appendChild(flyer);
          container.appendChild(card);
          return;
        }


        card.appendChild(
          title
        );


        card.appendChild(
          body
        );


        container.appendChild(
          card
        );
      }
    );

}


// ==========================================================
// 32. RESOURCES
// ==========================================================

async function loadResources(
  cohortId
) {

  let query =
    supabaseClient
      .from("resources")
      .select(`
        id,
        title,
        category,
        description,
        resource_type,
        external_url,
        drive_file_url,
        featured,
        active,
        display_order
      `)
      .eq("active", true);

  if (cohortId) {
    query = query.or(
      `cohort_id.is.null,cohort_id.eq.${cohortId}`
    );
  }

  const { data, error } =
    await query.order("display_order", { ascending: true });


  if (error) {

    console.error(
      "Could not load resources:",
      error
    );

    return [];

  }


  return data || [];

}


// ==========================================================
// 33. DISPLAY RESOURCES
// ==========================================================

function displayResources() {

  const grid =
    document.getElementById(
      "resourcesGrid"
    );


  const searchInput =
    document.getElementById(
      "resourceSearch"
    );


  const activeFilter =
    document.querySelector(
      ".resource-filter.active"
    );


  const category =
    activeFilter
      ?.dataset.category ||
    "all";


  if (!grid) {
    return;
  }


  const search =
    searchInput
      ? searchInput.value
          .trim()
          .toLowerCase()
      : "";


  const filtered =
    currentResources.filter(
      resource => {

        const resourceCategory =
          resource.category ||
          "";


        const matchesCategory =
          category ===
            "all" ||
          resourceCategory
            .toLowerCase() ===
          category
            .toLowerCase();


        const searchable =
          `${
            resource.title ||
            ""
          } ${
            resource.description ||
            ""
          } ${
            resource.category ||
            ""
          }`
            .toLowerCase();


        const matchesSearch =
          search ===
            "" ||
          searchable.includes(
            search
          );


        return (
          matchesCategory &&
          matchesSearch
        );

      }
    );


  grid.innerHTML =
    "";


  setText(
    "resourceCount",
    `${filtered.length} ${
      filtered.length === 1
        ? "resource"
        : "resources"
    }`
  );


  const empty =
    document.getElementById(
      "resourceEmpty"
    );


  if (
    filtered.length === 0
  ) {

    if (empty) {

      empty.style.display =
        "block";

    }


    return;

  }


  if (empty) {

    empty.style.display =
      "none";

  }


  filtered.forEach(
    resource => {

      const card =
        document.createElement(
          "article"
        );


      card.className =
        "resource-card";


      const label =
        document.createElement(
          "p"
        );


      label.className =
        "card-label";


      label.textContent =
        resource.category ||
        "Resource";


      const title =
        document.createElement(
          "h3"
        );


      title.textContent =
        resource.title ||
        "Resource";


      const description =
        document.createElement(
          "p"
        );


      description.textContent =
        resource.description ||
        "";


      card.appendChild(
        label
      );


      card.appendChild(
        title
      );


      card.appendChild(
        description
      );


      const href =
        safeURL(
          resource.external_url ||
          resource.drive_file_url
        );


      if (href) {

        const link =
          document.createElement(
            "a"
          );


        link.href =
          href;


        link.target =
          "_blank";


        link.rel =
          "noopener noreferrer";


        link.textContent =
          "Open Resource";


        card.appendChild(
          link
        );

      }


      grid.appendChild(
        card
      );

    }
  );

}


// ==========================================================
// 34. NEXT NSBE EVENT
// ==========================================================

function displayNextNSBEEvent(
  items
) {

  const now =
    new Date();


  const next =
    items.find(
      item =>
        item.category ===
          "nsbe_event" &&
        item.start >=
          now
    );


  if (!next) {

    setText(
      "nextNSBEEventTitle",
      "No upcoming NSBE event"
    );


    setText(
      "nextNSBEEventDate",
      "Check the calendar for updates."
    );


    return;

  }


  setText(
    "nextNSBEEventTitle",
    next.title
  );


  setText(
    "nextNSBEEventDate",
    formatFullDateTime(
      next.start
    )
  );

}


// ==========================================================
// 35. REFRESH ALL MEMBER PORTAL DATA
// ==========================================================

async function refreshMemberData() {

  const member =
    await loadCurrentMember();


  if (!member) {

    return null;

  }


  currentMember =
    member;


  currentCohort =
    await loadCurrentCohort(
      member.cohort_id
    );


  POINT_REQUIREMENT = currentCohort?.point_requirement || 10;

  displayCurrentMember(
    currentMember,
    currentCohort
  );


  const [
    points,
    oneOnOnes,
    strikes,
    events,
    announcements,
    resources,
    cohortPeople
  ] =
    await Promise.all([

      loadPointData(
        member.id
      ),

      loadOneOnOneData(
        member.id
      ),

      loadStrikeData(
        member.id
      ),

      loadPortalEvents(
        member.cohort_id
      ),

      loadAnnouncements(
        member.cohort_id
      ),

      loadResources()

      ,
      member.program_status === "active" ? loadPortalCohortDirectory(member.cohort_id) : Promise.resolve([])

    ]);


  currentPointSubmissions =
    points;


  currentOneOnOnes =
    oneOnOnes;


  currentStrikes =
    strikes;


  currentPortalEvents =
    events;


  currentAnnouncements =
    announcements;


  currentResources =
    resources;

  currentCohortDirectory = cohortPeople;


  displayPointData(
    points
  );


  displayOneOnOneData(
    oneOnOnes
  );


  displayStrikeData(
    strikes
  );


  displayAnnouncements(
    announcements
  );


  const invitationEvents=window.PortalMeetings?await PortalMeetings.calendarEvents('member',member.id):[];
  currentCalendarItems =
    buildCalendarItems(
      [...events,...invitationEvents],
      oneOnOnes,
      cohortPeople
    );


  displayNextEvent(
    currentCalendarItems
  );


  displayNextNSBEEvent(
    currentCalendarItems
  );


  renderCalendar();


  displayResources();
  displayMemberCohort();

  await refreshNewPortalFeatures();
  await PortalCompletion.member();
  await PortalMeetings.mount(document.getElementById('oneOnOnesPage'));


  refreshRevealAnimations();


  return member;

}

// ==========================================================
// 35A. LOAD PORTAL ACCESS
// ==========================================================

async function loadPortalAccess() {
  const permissions = await PortalManagement.loadAccess();

  const [
    member,
    director,
    sharedResult
  ] =
    await Promise.all([
      loadCurrentMember(),
      loadCurrentDirector(),
      supabaseClient.rpc("portal_shared_access")
    ]);

  if (sharedResult.error) throw new Error(sharedResult.error.message);
  hasSharedPortalAccess = sharedResult.data === true;
  const memberCohort = member ? await loadCurrentCohort(member.cohort_id) : null;
  const hasActiveMemberAccess = Boolean(member && member.program_status === "active" && memberCohort?.status === "active");
  currentMemberIsActive = hasActiveMemberAccess;

  currentMember = member;
  const memberViewButton = document.getElementById("openMemberViewButton");
  const directorViewButton = document.getElementById("openDirectorViewButton");
  if (memberViewButton) memberViewButton.hidden = !(director || (member && member.program_status === "active"));
  if (directorViewButton) directorViewButton.hidden = !(director && permissions.assignments.length);
  window.PortalManagement?.watchMember();


  let directorAssignment =
    null;

  let directorCohort =
    null;


  if (director) {

    directorAssignment =
      await loadCurrentDirectorAssignment(
        director.id
      );


    if (
      directorAssignment &&
      directorAssignment.cohort_id
    ) {

      directorCohort =
        await loadCurrentCohort(
          directorAssignment.cohort_id
        );

    }

  }


  currentDirector =
    director;

  currentDirectorAssignment =
    directorAssignment;


  return {

    member,

    director,

    directorAssignment,

    directorCohort,

    hasAdminAccess: permissions.is_admin,

    hasMemberAccess: hasActiveMemberAccess,

    hasSharedAccess: hasSharedPortalAccess,

    hasDirectorAccess:
      Boolean(
        director &&
        directorAssignment && permissions.assignments.length
      )

  };

}


// ==========================================================
// 36. LOGIN
// ==========================================================

if (loginForm) {

  loginForm.addEventListener(
    "submit",
    async function (
      event
    ) {

      event.preventDefault();


      const emailInput =
        document.getElementById(
          "email"
        );


      const passwordInput =
        document.getElementById(
          "password"
        );


      const email =
        emailInput
          .value
          .trim();


      const password =
        passwordInput
          .value;


      const submitButton =
        loginForm.querySelector(
          "button[type='submit']"
        );


      if (submitButton) {

        submitButton.disabled =
          true;


        submitButton.textContent =
          "Signing In...";

      }


      const {
        error
      } =
        await supabaseClient
          .auth
          .signInWithPassword({
            email,
            password
          });


      if (error) {

        console.error(
          "Login error:",
          error
        );


        if (submitButton) {

          submitButton.disabled =
            false;


          submitButton.textContent =
            "Enter Portal";

        }


        alert(
          "Login failed. Check your email and password."
        );


        return;

      }


      let access;
      try {
        access = await loadPortalAccess();
      } catch (error) {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = "Enter Portal";
        }
        alert(error.message || "Could not verify your portal access. Please try again.");
        return;
      }


      if (
        !access.hasMemberAccess &&
        !access.hasDirectorAccess && !access.hasAdminAccess && !access.hasSharedAccess
      ) {

        await supabaseClient
          .auth
          .signOut();


        if (submitButton) {

          submitButton.disabled =
            false;


          submitButton.textContent =
            "Enter Portal";

        }


        alert(
          "Your account is not connected to an active Trailblazers profile."
        );


        return;

      }


      if (
        access.hasMemberAccess
      ) {

        await refreshMemberData();

      }


      if (submitButton) {

        submitButton.disabled =
          false;


        submitButton.textContent =
          "Enter Portal";

      }


      loginPage.style.display =
        "none";


      if (access.hasMemberAccess) showMemberPortal();
      else if (access.hasDirectorAccess) await showDirectorPortal();
      else if (access.hasAdminAccess) await PortalManagement.show("admin");
      else if (access.hasSharedAccess) await showSharedMemberPortal();

    }
  );

}


// ==========================================================
// 37. RESTORE LOGIN SESSION
// ==========================================================

async function restoreSession() {

  const {
    data: { session },
    error
  } =
    await supabaseClient
      .auth
      .getSession();


  if (error) {

    console.error(
      "Session error:",
      error
    );

  }


  if (!session) {

    dashboard.style.display =
      "none";


    if (directorDashboard) {

      directorDashboard.style.display =
        "none";

    }


    loginPage.style.display =
      "grid";


    return;

  }


  const access =
    await loadPortalAccess();


  if (
    !access.hasMemberAccess &&
    !access.hasDirectorAccess && !access.hasAdminAccess && !access.hasSharedAccess
  ) {

    await supabaseClient
      .auth
      .signOut();


    dashboard.style.display =
      "none";


    if (directorDashboard) {

      directorDashboard.style.display =
        "none";

    }


    loginPage.style.display =
      "grid";


    return;

  }


  if (access.hasAdminAccess && !access.hasMemberAccess && !access.hasDirectorAccess) {
    await PortalManagement.show("admin");
    return;
  }

  if (
    access.hasMemberAccess
  ) {

    await refreshMemberData();


    showMemberPortal();


    return;

  }


  if (
    access.hasDirectorAccess
  ) {

    await showDirectorPortal();


    return;

  }

  if (access.hasSharedAccess) {
    await showSharedMemberPortal();
    return;
  }

}


// ==========================================================
// 38. LOG OUT
// ==========================================================

async function logoutPortal() {
  ++portalNavigationVersion;
  const buttons = document.querySelectorAll('#logoutButton, #directorLogoutButton, #managementLogout');
  buttons.forEach(b => b.disabled = true);
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    window.PortalManagement?.hide();
    currentMember = null;
    currentDirector = null;
    currentDirectorAssignment = null;
    currentCohort = null;
    currentDirectorCohort = null;
    dashboard.style.display = 'none';
    directorDashboard.style.display = 'none';
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    document.querySelectorAll('.modal-open').forEach(d => d.classList.remove('modal-open'));
    loginPage.style.display = 'grid';
    loginForm?.reset();
  } catch (error) { alert(`Could not sign out: ${error.message}`); }
  finally { buttons.forEach(b => b.disabled = false); }
}
window.logoutPortal = logoutPortal;
directorLogoutButton?.addEventListener('click', logoutPortal);
logoutButton?.addEventListener('click', logoutPortal);



// ==========================================================
// 39. POINT SUBMISSION FORM ELEMENTS
// ==========================================================

const homeSubmitPoints =
  document.getElementById(
    "homeSubmitPoints"
  );


const openPointForm =
  document.getElementById(
    "openPointForm"
  );


const pointFormCard =
  document.getElementById(
    "pointFormCard"
  );


const closePointForm =
  document.getElementById(
    "closePointForm"
  );


const pointSubmissionForm =
  document.getElementById(
    "pointSubmissionForm"
  );


// ==========================================================
// 40. OPEN POINT FORM
// ==========================================================

function openPointsForm() {

  showPage(
    "points"
  );


  if (pointFormCard) {

    pointFormCard.style.display =
      "block";


    pointFormCard.classList.add(
      "form-open"
    );


    pointFormCard.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

  }

}


if (homeSubmitPoints) {

  homeSubmitPoints
    .addEventListener(
      "click",
      openPointsForm
    );

}


if (openPointForm) {

  openPointForm
    .addEventListener(
      "click",
      openPointsForm
    );

}


// ==========================================================
// 41. CLOSE POINT FORM
// ==========================================================

if (closePointForm) {

  closePointForm
    .addEventListener(
      "click",
      function () {

        if (
          pointFormCard
        ) {

          pointFormCard.style.display =
            "none";


          pointFormCard.classList.remove(
            "form-open"
          );

        }

      }
    );

}


// ==========================================================
// 42. POINT SUBMISSION
// ==========================================================

if (pointSubmissionForm) {
  pointSubmissionForm.addEventListener("submit", event => PortalManagement.submitPoints(event));
}

// ==========================================================
// 43. CALENDAR BUTTONS
// ==========================================================

document
  .getElementById(
    "calendarPrevious"
  )
  ?.addEventListener(
    "click",
    function () {

      calendarCursor =
        new Date(
          calendarCursor
            .getFullYear(),
          calendarCursor
            .getMonth() -
            1,
          1
        );


      renderCalendar();

    }
  );


document
  .getElementById(
    "calendarNext"
  )
  ?.addEventListener(
    "click",
    function () {

      calendarCursor =
        new Date(
          calendarCursor
            .getFullYear(),
          calendarCursor
            .getMonth() +
            1,
          1
        );


      renderCalendar();

    }
  );


document
  .getElementById(
    "calendarToday"
  )
  ?.addEventListener(
    "click",
    function () {

      const today =
        new Date();


      calendarCursor =
        new Date(
          today.getFullYear(),
          today.getMonth(),
          1
        );


      renderCalendar();

    }
  );

// ==========================================================
// 43A. DIRECTOR CREATE EVENT FORM BUTTONS
// ==========================================================

if (directorCalendarCreateEventButton) {

  directorCalendarCreateEventButton
    .addEventListener(
      "click",
      openDirectorEventForm
    );

}

if (directorCreateEventButton) {

  directorCreateEventButton
    .addEventListener(
      "click",
      function () {

        showDirectorPage(
          "directorCalendar"
        );

        openDirectorEventForm();

      }
    );

}

if (directorCancelEventButton) {

  directorCancelEventButton
    .addEventListener(
      "click",
      closeDirectorEventForm
    );

}

if (directorCalendarPreviousButton) {

  directorCalendarPreviousButton
    .addEventListener(
      "click",
      function () {

        directorCalendarCursor.setMonth(
          directorCalendarCursor.getMonth() - 1
        );

        renderDirectorMonthlyCalendar();

      }
    );

}


if (directorCalendarTodayButton) {

  directorCalendarTodayButton
    .addEventListener(
      "click",
      function () {

        directorCalendarCursor =
          new Date();

        directorCalendarCursor.setDate(
          1
        );

        renderDirectorMonthlyCalendar();

      }
    );

}


if (directorCalendarNextButton) {

  directorCalendarNextButton
    .addEventListener(
      "click",
      function () {

        directorCalendarCursor.setMonth(
          directorCalendarCursor.getMonth() + 1
        );

        renderDirectorMonthlyCalendar();

      }
    );

}

if (directorEventForm) {

  directorEventForm.addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      const title =
        document.getElementById(
          "directorEventTitle"
        ).value.trim();


      const category =
        document.getElementById(
          "directorEventCategory"
        ).value;


      const meetingType =
        document.getElementById(
          "directorEventMeetingType"
        ).value;


      const startTime =
        document.getElementById(
          "directorEventStart"
        ).value;


      const endTime =
        document.getElementById(
          "directorEventEnd"
        ).value;


      const location =
        document.getElementById(
          "directorEventLocation"
        ).value.trim();


      const locationTBD =
        document.getElementById(
          "directorEventLocationTBD"
        ).checked;


      const allDay =
        document.getElementById(
          "directorEventAllDay"
        ).checked;


      const dressCode =
        document.getElementById(
          "directorEventDressCode"
        ).value.trim();


      const whatToBring =
        document.getElementById(
          "directorEventBring"
        ).value.trim();


      const description =
        document.getElementById(
          "directorEventDescription"
        ).value.trim();


      // Required fields
      if (
        !title ||
        !category ||
        !startTime
      ) {

        setText(
          "directorEventMessage",
          "Please complete the required fields."
        );

        return;

      }


      // Make sure the director has a cohort
      if (!currentDirectorCohort) {

        setText(
          "directorEventMessage",
          "Your director cohort could not be found."
        );

        return;

      }


      // End time must be after start time
      if (
        endTime &&
        (allDay ? endTime.slice(0,10) < startTime.slice(0,10) : new Date(endTime) <= new Date(startTime))
      ) {

        setText(
          "directorEventMessage",
          "The end time must be after the start time."
        );

        return;

      }


      setText(
        "directorEventMessage",
        "Creating event..."
      );


      const wasEditing = Boolean(editingDirectorEventId);
      const saveButton = document.getElementById('directorSaveEventButton');
      if (saveButton.disabled) return;
      saveButton.disabled = true;
      let data, error;
      try {
        const result = await supabaseClient.rpc('portal_save_event', {
          record_id: editingDirectorEventId || null,
          payload: {
            cohort_id: currentDirectorCohort.id, title,
            event_category: category === 'nsbe' ? 'nsbe_event' : 'tb_event',
            meeting_type: meetingType || null, description: description || null,
            all_day: allDay, all_day_start: allDay ? startTime.slice(0,10) : null,
            all_day_end: allDay ? (endTime || startTime).slice(0,10) : null,
            start_time: allDay ? null : new Date(startTime).toISOString(),
            end_time: !allDay && endTime ? new Date(endTime).toISOString() : null,
            location: locationTBD ? null : location || null, location_tbd: locationTBD,
            dress_code: dressCode || null, what_to_bring: whatToBring || null, active: true,
            notify_members: document.getElementById('directorEventNotifyMembers').checked
          }
        });
        data = result.data; error = result.error;
      } catch (e) { error = e; }
      finally { saveButton.disabled = false; }


// Supabase error
if (error) {

  console.error(
    wasEditing
      ? "Could not update event:"
      : "Could not create event:",
    error
  );

  setText(
    "directorEventMessage",
    wasEditing
      ? "The event could not be updated."
      : "The event could not be created."
  );

  return;

}


console.log(
  wasEditing
    ? "Event updated:"
    : "Event created:",
  data
);


// We are finished editing this event
editingDirectorEventId =
  null;


// Refresh the calendar list
const directorCalendarEvents =
  await loadDirectorCalendarEvents(
    currentDirectorCohort.id
  );


displayDirectorCalendarEvents(
  directorCalendarEvents
);

renderDirectorMonthlyCalendar();

// Refresh Director Home event count
const upcomingEventsCount =
  await loadDirectorUpcomingEventsCount(
    currentDirectorCohort.id
  );


setText(
  "directorUpcomingEventsCount",
  upcomingEventsCount
);


// Reset the form
directorEventForm.reset();
closeDirectorEventForm();
    }
  );

}

// ==========================================================
// 44. ONE-ON-ONE SCHEDULE MODAL BUTTONS
// ==========================================================

document
  .getElementById(
    "openScheduleModal"
  )
  ?.addEventListener(
    "click",
    function () {

      PortalMeetings.open(document.querySelector('#oneOnOnesPage .meeting-inbox'));

    }
  );


document
  .getElementById(
    "closeScheduleModal"
  )
  ?.addEventListener(
    "click",
    closeScheduleModal
  );


document
  .getElementById(
    "scheduleCancelButton"
  )
  ?.addEventListener(
    "click",
    closeScheduleModal
  );


document
  .getElementById(
    "scheduleForm"
  )
  ?.addEventListener(
    "submit",
    submitOneOnOneSchedule
  );


// ==========================================================
// 45. EVENT DETAILS MODAL BUTTON
// ==========================================================

document
  .getElementById(
    "closeEventDetails"
  )
  ?.addEventListener(
    "click",
    closeEventDetails
  );


// ==========================================================
// 46. CLOSE MODALS BY CLICKING BACKDROP
// ==========================================================

document
  .getElementById(
    "scheduleModal"
  )
  ?.addEventListener(
    "click",
    function (
      event
    ) {

      if (
        event.target ===
        event.currentTarget
      ) {

        closeScheduleModal();

      }

    }
  );


document
  .getElementById(
    "eventDetailsModal"
  )
  ?.addEventListener(
    "click",
    function (
      event
    ) {

      if (
        event.target ===
        event.currentTarget
      ) {

        closeEventDetails();

      }

    }
  );


// ==========================================================
// 47. CLOSE MODALS WITH ESCAPE
// ==========================================================

document.addEventListener(
  "keydown",
  function (
    event
  ) {

    if (
      event.key !==
      "Escape"
    ) {

      return;

    }


    closeScheduleModal();

    closeEventDetails();

  }
);


// ==========================================================
// 48. RESOURCE SEARCH
// ==========================================================

document
  .getElementById(
    "resourceSearch"
  )
  ?.addEventListener(
    "input",
    displayResources
  );


// ==========================================================
// 49. RESOURCE FILTERS
// ==========================================================

document
  .querySelectorAll(
    ".resource-filter"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        function () {

          document
            .querySelectorAll(
              ".resource-filter"
            )
            .forEach(
              filter => {

                filter.classList.remove(
                  "active"
                );

              }
            );


          button.classList.add(
            "active"
          );


          displayResources();

        }
      );

    }
  );


// ==========================================================
// 50. REVEAL ANIMATIONS
// ==========================================================

// ==========================================================
// 49A. ALUMNI, NOTIFICATIONS, AND DIRECTOR OPERATIONS
// ==========================================================

// ==========================================================
// 49. MEMBER PROFILE EDITING
// ==========================================================

function openProfileEditor() {
  if (!currentMember) return;
  PortalInventory.editProfile().catch(error => {
    document.getElementById('inventoryProfileStatus').textContent=error.message;
  });
}
document.getElementById("openProfileEditor")?.addEventListener("click", openProfileEditor);

async function loadAlumni() {

  const { data, error } = await supabaseClient
    .rpc("portal_alumni_extended")
    .order("graduation_year", { ascending: false });

  if (error) {
    console.error("Could not load alumni:", error);
    return [];
  }

  return data || [];

}

function displayAlumni() {

  const grid = document.getElementById("alumniGrid");
  const empty = document.getElementById("alumniEmpty");
  const filters = document.getElementById("alumniCohortFilters");
  const search = (document.getElementById("alumniSearch")?.value || "").trim().toLowerCase();

  if (!grid || !empty) return;

  if (filters) {
    const cohorts = [...new Set(currentAlumni.map(alumnus => alumnus.cohort_name || (alumnus.class_number ? `Class ${alumnus.class_number}` : null)).filter(Boolean))];
    filters.innerHTML = "";
    ["all", ...cohorts].forEach(cohort => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `resource-filter${activeAlumniCohort === cohort ? " active" : ""}`;
      button.textContent = cohort === "all" ? "All classes" : cohort;
      button.addEventListener("click", () => {
        activeAlumniCohort = cohort;
        displayAlumni();
      });
      filters.appendChild(button);
    });
  }

  const matchingAlumni = currentAlumni.filter(alumnus => {
    const searchable = [
      alumnus.first_name,
      alumnus.last_name,
      alumnus.preferred_name,
      alumnus.major, alumnus.minor, alumnus.organizations, alumnus.career_interests, alumnus.graduation_year,
      alumnus.current_company,
      alumnus.current_title,
      alumnus.cohort_name
    ].filter(Boolean).join(" ").toLowerCase();
    const cohort = alumnus.cohort_name || (alumnus.class_number ? `Class ${alumnus.class_number}` : "");
    return searchable.includes(search) && (activeAlumniCohort === "all" || cohort === activeAlumniCohort);
  }).sort((a,b) => {
    const aName = `${a.preferred_name || a.first_name || "Trailblazer"} ${a.last_name || ""}`.trim();
    const bName = `${b.preferred_name || b.first_name || "Trailblazer"} ${b.last_name || ""}`.trim();
    return aName.localeCompare(bName, undefined, {sensitivity:"base"}) * (alumniSortDirection === "asc" ? 1 : -1);
  });

  grid.innerHTML = "";
  empty.style.display = matchingAlumni.length ? "none" : "block";

  matchingAlumni.forEach(alumnus => {
    const name = `${alumnus.preferred_name || alumnus.first_name || "Trailblazer"} ${alumnus.last_name || ""}`.trim();
    const cohort = alumnus.cohort_name || (alumnus.class_number ? `Class ${alumnus.class_number}` : "Trailblazers Alum");
    const contact = alumnus.contact_visible && alumnus.contact_email
      ? `<a href="mailto:${escapeHTML(alumnus.contact_email)}">Contact</a>`
      : "";
    const linkedin = safeURL(alumnus.linkedin_url)
      ? `<a href="${escapeHTML(safeURL(alumnus.linkedin_url))}" target="_blank" rel="noopener">LinkedIn</a>`
      : "";
    const links = [contact, linkedin].filter(Boolean).join("");

    const card = document.createElement("article");
    card.className = "alumni-card";
    card.innerHTML = `
      <div class="alumni-avatar">${escapeHTML(getInitials(alumnus.first_name, alumnus.last_name))}</div>
      <p class="card-label">${escapeHTML(cohort)}</p>
      <h2>${escapeHTML(name)}</h2>
      <p>${escapeHTML([alumnus.current_title, alumnus.current_company].filter(Boolean).join(" · ") || "Career details coming soon")}</p>
      <p class="alumni-major">${escapeHTML([alumnus.major, alumnus.minor, alumnus.graduation_year].filter(Boolean).join(" · "))}</p>
      <p>${escapeHTML([alumnus.organizations,alumnus.career_interests].filter(Boolean).join(" · "))}</p><div class="alumni-links">${links}</div>`;
    grid.appendChild(card);
  });

}

async function loadNotifications() {

  if (!currentMember) return [];

  const { data, error } = await supabaseClient
    .from("member_notifications")
    .select("id, title, body, notification_type, target_page, read_at, created_at")
    .eq("member_id", currentMember.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Could not load notifications:", error);
    return [];
  }

  return data || [];

}

function displayNotifications() {

  const list = document.getElementById("notificationList");
  const badge = document.getElementById("notificationBadge");
  if (!list || !badge) return;

  const unreadCount = currentNotifications.filter(notification => !notification.read_at).length;
  const bell=document.getElementById('notificationBell');
  if(bell){bell.hidden=!currentMember||sharedMemberView;bell.classList.toggle('has-unread',unreadCount>0);bell.setAttribute('aria-label',unreadCount?'Notifications, '+unreadCount+' unread':'Notifications');}
  badge.hidden = unreadCount === 0;
  badge.textContent = unreadCount;
  list.innerHTML = "";

  if (!currentNotifications.length) {
    list.innerHTML = '<div class="empty-state">You are all caught up.</div>';
    return;
  }

  currentNotifications.forEach(notification => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `notification-item${notification.read_at ? "" : " unread"}`;
    item.innerHTML = `
      <span class="notification-type">${escapeHTML(formatStatus(notification.notification_type || "update"))}</span>
      <strong>${escapeHTML(notification.title)}</strong>
      <span>${escapeHTML(notification.body || "")}</span>
      <small>${escapeHTML(formatFullDateTime(notification.created_at))}</small>`;
    item.addEventListener("click", () => {
      if (notification.target_page) showPage(notification.target_page);
    });
    list.appendChild(item);
  });

}

async function loadDirectorMembers() {

  if (!currentDirectorCohort) return [];

  const { data, error } = await supabaseClient
    .from("members")
    .select("id, first_name, last_name, preferred_name, uf_email, major, graduation_year, program_status")
    .eq("cohort_id", currentDirectorCohort.id)
    .order("last_name", { ascending: true });

  if (error) {
    console.error("Could not load director members:", error);
    return [];
  }

  return data || [];

}

function populateDirectorOneOnOneMemberSelect() {

  const select = document.getElementById("directorOneOnOneMember");
  if (!select) return;

  const selected = select.value;
  select.innerHTML = '<option value="">Select a member</option>';
  currentDirectorMembers.filter(member => member.program_status === "active").sort((a,b)=>`${a.preferred_name||a.first_name||"Member"} ${a.last_name||""}`.localeCompare(`${b.preferred_name||b.first_name||"Member"} ${b.last_name||""}`,undefined,{sensitivity:"base"})).forEach(member => {
    const option = document.createElement("option");
    option.value = member.id;
    option.textContent = `${member.preferred_name || member.first_name || "Member"} ${member.last_name || ""}`.trim();
    select.appendChild(option);
  });
  select.value = selected;

}

function displayDirectorMembers() {

  const grid = document.getElementById("directorMembersGrid");
  const search = (document.getElementById("directorMemberSearch")?.value || "").toLowerCase().trim();
  if (!grid) return;

  const members = currentDirectorMembers.filter(member =>
    [member.first_name, member.last_name, member.preferred_name, member.major, member.uf_email]
      .filter(Boolean).join(" ").toLowerCase().includes(search)
  ).sort((a,b)=>`${a.preferred_name||a.first_name||"Member"} ${a.last_name||""}`.localeCompare(`${b.preferred_name||b.first_name||"Member"} ${b.last_name||""}`,undefined,{sensitivity:"base"})*(directorMemberSortDirection==="asc"?1:-1));

  grid.innerHTML = "";
  if (!members.length) {
    grid.innerHTML = '<div class="empty-state">No Trailblazers match your search.</div>';
    return;
  }

  members.forEach(member => {
    const name = `${member.preferred_name || member.first_name || "Member"} ${member.last_name || ""}`.trim();
    const card = document.createElement("article");
    card.className = "director-member-card";
    card.innerHTML = `
      <div class="director-avatar">${escapeHTML(getInitials(member.first_name, member.last_name))}</div>
      <h2>${escapeHTML(name)}</h2>
      <p>${escapeHTML(member.major || "Major not listed")}</p>
      <p class="member-meta">${escapeHTML(member.uf_email || "")}</p>
      <button class="secondary-button" type="button">View profile</button>`;
    card.querySelector("button").addEventListener("click", () => openDirectorMemberProfile(member));
    grid.appendChild(card);
  });

}

async function openDirectorMemberProfile(member) {
  // Only open profiles from the already cohort-scoped director roster.
  if (!member || !currentDirectorMembers.some(row => row.id === member.id)) return;
  const canCare = currentDirectorAssignment?.capabilities?.includes("care") === true;
  const canPoints = currentDirectorAssignment?.capabilities?.includes("points") === true;
  const canStrikes = currentDirectorAssignment?.capabilities?.includes("strikes") === true;
  const canMeetings = currentDirectorAssignment?.capabilities?.includes("meetings") === true;
  const baseFields = "id,first_name,last_name,preferred_name,uf_email,personal_email,phone,pronouns,major,minor,college,graduation_year,birthday_month,birthday_day,organizations,academic_interests,career_interests,research_interests,leadership_roles,linkedin_url,professional_interests,program_status,cohort_id";
  const [profileResult, pointsResult, strikesResult, meetingsResult, careResult] = await Promise.all([
    supabaseClient.from("members").select(baseFields).eq("id", member.id).eq("cohort_id", currentDirectorCohort.id).maybeSingle(),
    canPoints ? supabaseClient.from("point_submissions").select("activity_name,points_requested,points_awarded,status,submitted_at,activity_date,director_note").eq("member_id", member.id).order("submitted_at", { ascending: false }).limit(12) : Promise.resolve({ data: [], error: null }),
    canStrikes ? supabaseClient.from("strikes").select("reason,status,issued_at,resolution_note").eq("member_id", member.id).order("issued_at", { ascending: false }).limit(12) : Promise.resolve({ data: [], error: null }),
    canMeetings ? supabaseClient.from("one_on_ones").select("director_id,scheduled_date,status,meeting_method,location_method,completed_date").eq("member_id", member.id).order("scheduled_date", { ascending: false }).limit(12) : Promise.resolve({ data: [], error: null }),
    canCare ? supabaseClient.from("members").select("dietary_preference,food_allergies,dietary_restrictions").eq("id", member.id).eq("cohort_id", currentDirectorCohort.id).maybeSingle() : Promise.resolve({ data: null, error: null })
  ]);
  for (const result of [profileResult, pointsResult, strikesResult, meetingsResult, careResult]) {
    if (result.error) { alert(`Could not load this profile: ${result.error.message}`); return; }
  }
  const profile = profileResult.data;
  if (!profile) { alert("This Trailblazer profile is not available to your cohort."); return; }
  const meetingDirectorIds = [...new Set((meetingsResult.data || []).map(meeting => meeting.director_id).filter(Boolean))];
  const meetingDirectorNames = new Map();
  if (meetingDirectorIds.length) {
    const { data: meetingDirectors } = await supabaseClient.from("directors").select("id,first_name,last_name").in("id", meetingDirectorIds);
    for (const director of meetingDirectors || []) meetingDirectorNames.set(director.id, `${director.first_name || "Director"} ${director.last_name || ""}`.trim());
  }
  const esc = escapeHTML;
  const value = x => x === null || x === undefined || x === "" ? "Not provided" : esc(x);
  const row = (label, x) => `<div class="director-profile-field"><dt>${esc(label)}</dt><dd>${value(x)}</dd></div>`;
  const section = (title, rows) => rows.length ? `<section class="director-profile-section"><h3>${esc(title)}</h3><dl>${rows.join("")}</dl></section>` : "";
  const memberName = `${profile.preferred_name || profile.first_name} ${profile.last_name || ""}`.trim();
  const careSummary = [
    careResult.data?.dietary_preference && `Dietary preferences: ${careResult.data.dietary_preference}`,
    careResult.data?.food_allergies && `Food allergies: ${careResult.data.food_allergies}`,
    careResult.data?.dietary_restrictions && `Dietary restrictions: ${careResult.data.dietary_restrictions}`,
    careResult.data?.accommodations
  ].filter(Boolean).join(" · ");
  const details = section("Contact & academics", [
    row("Portal email", profile.uf_email), row("Personal email", profile.personal_email), row("Phone", profile.phone),
    row("Pronouns", profile.pronouns), row("Major", profile.major), row("Minor", profile.minor), row("College", profile.college), row("Graduation year", profile.graduation_year),
    row("Status", profile.program_status)
  ]) + section("About", [row("Organizations and leadership roles", [profile.organizations, profile.leadership_roles].filter(Boolean).join(" · ")), row("Career, academic, and research interests", [profile.career_interests, profile.academic_interests, profile.research_interests].filter(Boolean).join(" · ")), row("LinkedIn", profile.linkedin_url), row("Professional interests", profile.professional_interests), row("Birthday", profile.birthday_month && profile.birthday_day ? `${profile.birthday_month}/${profile.birthday_day}` : null)]) +
    (canCare ? section("Dietary restrictions and accommodations", [row("Dietary restrictions and accommodations", careSummary)]) : "") +
    (canPoints ? section("Points", (pointsResult.data || []).map(p => `<div class="director-profile-record"><strong>${value(p.activity_name)}</strong><span>${value(p.status)} · ${value(p.points_awarded ?? p.points_requested)} points</span><small>${value(p.activity_date || p.submitted_at)}${p.director_note ? ` · ${value(p.director_note)}` : ""}</small></div>`)) : "") +
    (canStrikes ? section("Strikes", (strikesResult.data || []).map(s => `<div class="director-profile-record"><strong>${value(s.reason)}</strong><span>${value(s.status)} · ${value(s.issued_at)}</span>${s.resolution_note ? `<small>${value(s.resolution_note)}</small>` : ""}</div>`)) : "") +
    (canMeetings ? section("One-on-ones with all directors", (meetingsResult.data || []).map(m => `<div class="director-profile-record"><strong>${value(m.status)} · ${value(meetingDirectorNames.get(m.director_id) || "Director")}</strong><span>${value(m.scheduled_date)}</span><small>${value(m.meeting_method || m.location_method)}</small></div>`)) : "");
  let dialog = document.getElementById("directorMemberProfileDialog");
  if (!dialog) {
    dialog = document.createElement("dialog"); dialog.id = "directorMemberProfileDialog"; dialog.className = "director-profile-dialog";
    document.body.append(dialog);
  }
  dialog.innerHTML = `<div class="director-profile-header"><div><p class="eyebrow">TRAILBLAZER PROFILE</p><h2>${esc(memberName)}</h2><p>${value(profile.major)} · Class ${value(currentDirectorCohort.class_number)}</p></div><button type="button" class="secondary-button" data-profile-close>Close</button></div><div class="director-profile-body">${details}</div><div class="director-profile-actions">${canStrikes ? '<button type="button" class="secondary-button" data-profile-strike>Submit a strike</button>' : ''}<button type="button" class="primary-button" data-profile-meeting>Schedule a one-on-one</button></div>`;
  dialog.querySelector("[data-profile-close]").onclick = () => dialog.close();
  dialog.querySelector("[data-profile-meeting]").onclick = () => {
    dialog.close(); showDirectorPage("directorOneOnOnes"); populateDirectorOneOnOneMemberSelect();
    PortalMeetings.open(document.querySelector('#directorOneOnOnesPage .meeting-inbox'),currentDirector.id,profile.id);
  };
  if (canStrikes) dialog.querySelector("[data-profile-strike]").onclick = () => openDirectorStrikeDialog(profile, memberName, dialog);
  dialog.showModal();
}

function openDirectorStrikeDialog(member, memberName, profileDialog) {
  let dialog = document.getElementById("directorStrikeDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "directorStrikeDialog";
    dialog.className = "director-profile-dialog";
    document.body.append(dialog);
  }
  dialog.innerHTML = `<form class="stacked-form"><div class="director-profile-header"><div><p class="eyebrow">ACCOUNTABILITY</p><h2>Submit a strike</h2><p>For ${escapeHTML(memberName)}</p></div><button type="button" class="secondary-button" data-strike-close>Close</button></div><label for="directorStrikeReason">Reason</label><textarea id="directorStrikeReason" rows="4" required maxlength="2000"></textarea><label for="directorStrikeNote">Additional note (optional)</label><textarea id="directorStrikeNote" rows="3" maxlength="2000"></textarea><p class="form-message" role="status" aria-live="polite"></p><button type="submit" class="primary-button">Save strike</button></form>`;
  dialog.querySelector("[data-strike-close]").onclick = () => dialog.close();
  dialog.querySelector("form").onsubmit = async event => {
    event.preventDefault();
    const submit = dialog.querySelector("button[type='submit']");
    const message = dialog.querySelector(".form-message");
    submit.disabled = true;
    try {
      const result = await supabaseClient.rpc("portal_mutate", { kind: "strike", record_id: null, payload: {
        member_id: member.id,
        reason: dialog.querySelector("#directorStrikeReason").value.trim(),
        issued_at: new Date().toISOString(),
        staff_note: dialog.querySelector("#directorStrikeNote").value.trim() || null
      }});
      if (result.error) throw result.error;
      dialog.close(); profileDialog.close();
      await openDirectorMemberProfile(member);
    } catch (error) {
      message.textContent = error.message || "The strike could not be saved.";
      submit.disabled = false;
    }
  };
  dialog.showModal();
}

async function refreshNewPortalFeatures() {

  const [alumni, notifications] = await Promise.all([loadAlumni(), loadNotifications()]);
  currentAlumni = alumni;
  currentNotifications = notifications;
  displayAlumni();
  displayNotifications();
  await PortalInventory.refreshMember();
  await PortalInventory.refreshProfileAndRules();

}

async function scheduleDirectorOneOnOne(event) {

  event.preventDefault();
  const memberId = document.getElementById("directorOneOnOneMember")?.value;
  const scheduledDate = document.getElementById("directorOneOnOneDate")?.value;
  const meetingMethod = "in_person";
  const location = document.getElementById("directorOneOnOneLocation")?.value.trim();

  if (!memberId || !scheduledDate || !meetingMethod) {
    setText("directorOneOnOneMessage", "Please complete the required fields.");
    return;
  }

  const date = new Date(scheduledDate);
  if (Number.isNaN(date.getTime()) || date <= new Date()) {
    setText("directorOneOnOneMessage", "Choose a future date and time.");
    return;
  }

  const button = document.getElementById("directorSaveOneOnOneButton");
  button.disabled = true;
  button.textContent = "Scheduling...";

  const { error } = await supabaseClient.rpc("director_schedule_one_on_one", {
    p_member_id: memberId,
    p_scheduled_date: date.toISOString(),
    p_meeting_method: meetingMethod,
    p_location_method: location || null
  });

  button.disabled = false;
  button.textContent = "Schedule Meeting";

  if (error) {
    console.error("Could not schedule director one-on-one:", error);
    setText("directorOneOnOneMessage", error.message || "The meeting could not be scheduled.");
    return;
  }

  setText("directorOneOnOneMessage", "Meeting scheduled. The member will receive a notification.");
  directorOneOnOneForm.reset();
  await refreshDirectorData();

}

async function publishDirectorContent(event, type) {

  event.preventDefault();
  const form = event.currentTarget;
  const isAnnouncement = type === "announcement";
  const title = document.getElementById(isAnnouncement ? "directorAnnouncementTitle" : "directorResourceTitle").value.trim();
  const messageId = isAnnouncement ? "directorAnnouncementMessage" : "directorResourceMessage";
  const rpc = isAnnouncement ? "publish_cohort_announcement" : "publish_cohort_resource";
  const submitButton = event.currentTarget.querySelector("button[type='submit']");
  let uploadedFilePath = null;
  let flyer = null;
  let params;

  if (isAnnouncement) {
    const file = document.getElementById("directorAnnouncementFlyer")?.files?.[0];
    if (file) {
      const flyerTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
      if (file.size > 50 * 1024 * 1024) {
        setText(messageId, "Flyers must be 50 MB or smaller.");
        return;
      }
      if (!flyerTypes.includes(file.type)) {
        setText(messageId, "Use a PDF, JPG, PNG, or WebP flyer.");
        return;
      }
      if (!currentDirectorCohort?.id) {
        setText(messageId, "Your assigned cohort could not be found.");
        return;
      }
      const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120) || "flyer";
      uploadedFilePath = `${currentDirectorCohort.id}/announcement-flyers/${crypto.randomUUID()}-${safeName}`;
      flyer = { path: uploadedFilePath, name: file.name, type: file.type, size: file.size };
      submitButton.disabled = true;
      submitButton.textContent = "Uploading flyer...";
      const { error: uploadError } = await supabaseClient.storage.from("trailblazers-resources").upload(uploadedFilePath, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        submitButton.disabled = false;
        submitButton.textContent = "Publish announcement";
        setText(messageId, uploadError.message || "The flyer could not be uploaded.");
        return;
      }
    }
    params = {
      p_title: title,
      p_body: document.getElementById("directorAnnouncementBody").value.trim()
    };
  } else {
    const urlInput = document.getElementById("directorResourceUrl");
    const file = document.getElementById("directorResourceFile")?.files?.[0];
    let resourceUrl = urlInput.value.trim();

    if (!resourceUrl && !file) {
      setText(messageId, "Add a link or choose a file to upload.");
      return;
    }

    if (file) {
      if (!currentDirectorCohort) {
        setText(messageId, "Your assigned cohort could not be found.");
        return;
      }

      if (file.size > 50 * 1024 * 1024) {
        setText(messageId, "Files must be 50 MB or smaller.");
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = "Uploading file...";
      const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "file";
      const fileId = window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      uploadedFilePath = `${currentDirectorCohort.id}/${fileId}.${extension}`;
      const { error: uploadError } = await supabaseClient
        .storage
        .from("trailblazers-resources")
        .upload(uploadedFilePath, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false
        });

      if (uploadError) {
        console.error("Could not upload resource file:", uploadError);
        submitButton.disabled = false;
        submitButton.textContent = "Publish resource";
        setText(messageId, uploadError.message || "The file could not be uploaded.");
        return;
      }

      resourceUrl = supabaseClient
        .storage
        .from("trailblazers-resources")
        .getPublicUrl(uploadedFilePath)
        .data
        .publicUrl;
    }

    params = {
      p_title: title,
      p_category: document.getElementById("directorResourceCategory").value,
      p_url: resourceUrl,
      p_description: document.getElementById("directorResourceDescription").value.trim() || null
    };
  }

  submitButton.disabled = true;
  submitButton.textContent = isAnnouncement ? "Publishing..." : "Publishing resource...";

  const { data: published, error } = await supabaseClient.rpc(rpc, params);
  submitButton.disabled = false;
  submitButton.textContent = isAnnouncement ? "Publish announcement" : "Publish resource";

  if (error) {
    console.error(`Could not publish ${type}:`, error);
    if (uploadedFilePath) {
      await supabaseClient.storage.from("trailblazers-resources").remove([uploadedFilePath]);
    }
    const schemaCacheMissing =
      error.code === "PGRST202" ||
      error.message?.includes("schema cache");
    setText(
      messageId,
      schemaCacheMissing
        ? "Publishing has not been enabled in Supabase yet. Apply the portal migrations, then refresh the schema cache."
        : (error.message || "Could not publish this update.")
    );
    return;
  }

  if (flyer) {
    const announcementId = Array.isArray(published) ? published[0]?.id : published?.id;
    if (!announcementId) {
      await supabaseClient.storage.from("trailblazers-resources").remove([flyer.path]);
      setText(messageId, "The announcement was published, but its flyer could not be attached. Refresh and edit the announcement to try again.");
      return;
    }
    const { error: attachmentError } = await supabaseClient.rpc("portal_set_announcement_attachment", {
      p_announcement_id: announcementId,
      p_path: flyer.path,
      p_name: flyer.name,
      p_content_type: flyer.type,
      p_size: flyer.size
    });
    if (attachmentError) {
      await supabaseClient.storage.from("trailblazers-resources").remove([flyer.path]);
      setText(messageId, `The announcement was published, but the flyer could not be attached: ${attachmentError.message}`);
      return;
    }
  }

  form.reset();
  setText(messageId, `${isAnnouncement ? "Announcement" : "Resource"} published. Members have been notified.`);
}

document.getElementById("alumniSearch")?.addEventListener("input", displayAlumni);
document.getElementById("alumniSort")?.addEventListener("change", event => { alumniSortDirection = event.target.value; displayAlumni(); });
document.getElementById("directorMemberSearch")?.addEventListener("input", displayDirectorMembers);
document.getElementById("directorMemberSort")?.addEventListener("change", event => { directorMemberSortDirection = event.target.value; displayDirectorMembers(); });
document.getElementById("cohortDirectorySearch")?.addEventListener("input", displayMemberCohort);
document.getElementById("cohortDirectorySort")?.addEventListener("change", event => { cohortDirectorySortDirection = event.target.value; displayMemberCohort(); });
document.getElementById("directorScheduleOneOnOneButton")?.addEventListener("click", ()=>PortalMeetings.open(document.querySelector('#directorOneOnOnesPage .meeting-inbox'),currentDirector?.id||''));
document.getElementById("directorCancelOneOnOneButton")?.addEventListener("click", closeDirectorOneOnOneForm);
document.getElementById("directorOneOnOneForm")?.addEventListener("submit", scheduleDirectorOneOnOne);
document.getElementById("directorAnnouncementForm")?.addEventListener("submit", event => publishDirectorContent(event, "announcement"));
document.getElementById("directorResourceForm")?.addEventListener("submit", event => publishDirectorContent(event, "resource"));
document.getElementById("markNotificationsRead")?.addEventListener("click", async () => {
  const { error } = await supabaseClient.rpc("mark_my_notifications_read");
  if (!error) {
    currentNotifications = currentNotifications.map(notification => ({ ...notification, read_at: notification.read_at || new Date().toISOString() }));
    displayNotifications();
  }
});

function refreshRevealAnimations() {

  const elements =
    document.querySelectorAll(`
      .stat-card,
      .dashboard-card,
      .director-card,
      .profile-card,
      .announcement-card,
      .resource-card,
      .calendar-shell
    `);


  if (
    !(
      "IntersectionObserver"
      in window
    )
  ) {

    elements.forEach(
      element => {

        element.classList.add(
          "visible"
        );

      }
    );


    return;

  }


  const observer =
    new IntersectionObserver(
      entries => {

        entries.forEach(
          entry => {

            if (
              entry.isIntersecting
            ) {

              entry.target
                .classList
                .add(
                  "visible"
                );


              observer.unobserve(
                entry.target
              );

            }

          }
        );

      },
      {
        threshold: 0.08
      }
    );


  elements.forEach(
    element => {

      element.classList.add(
        "reveal"
      );


      observer.observe(
        element
      );

    }
  );

}


// ==========================================================
// 51. INITIAL PAGE STATE
// ==========================================================

if (pointFormCard) {

  pointFormCard.style.display =
    "none";

}

window.PortalNav = {
  attach(scroller, railClass = "portal-nav-rail") {
    if (!scroller || scroller.dataset.navRailReady === "true") return () => {};
    scroller.dataset.navRailReady = "true";
    const rail = document.createElement("div");
    rail.className = railClass;
    const previous = document.createElement("button");
    previous.type = "button";
    previous.className = "nav-rail-arrow";
    previous.setAttribute("aria-label", "Scroll navigation left");
    previous.textContent = "‹";
    const next = document.createElement("button");
    next.type = "button";
    next.className = "nav-rail-arrow";
    next.setAttribute("aria-label", "Scroll navigation right");
    next.textContent = "›";
    scroller.parentNode.insertBefore(rail, scroller);
    rail.append(previous, scroller, next);
    const update = () => {
      const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      previous.hidden = next.hidden = max < 4;
      previous.disabled = scroller.scrollLeft <= 2;
      next.disabled = scroller.scrollLeft >= max - 2;
    };
    previous.addEventListener("click", () => scroller.scrollBy({ left: -Math.max(220, scroller.clientWidth * 0.72), behavior: "smooth" }));
    next.addEventListener("click", () => scroller.scrollBy({ left: Math.max(220, scroller.clientWidth * 0.72), behavior: "smooth" }));
    scroller.addEventListener("scroll", update, { passive: true });
    scroller.addEventListener("click", () => requestAnimationFrame(update));
    window.addEventListener("resize", update);
    if ("ResizeObserver" in window) new ResizeObserver(update).observe(scroller);
    requestAnimationFrame(update);
    return update;
  }
};

document.querySelectorAll(".sidebar .nav-links").forEach(nav => window.PortalNav.attach(nav));

function initBugReport() {
  const button = document.getElementById("bugReportButton");
  const dialog = document.getElementById("bugReportDialog");
  const form = document.getElementById("bugReportForm");
  if (!button || !dialog || !form) return;

  const locationSelect = document.getElementById("bugReportLocation");
  const otherLocationWrap = document.getElementById("bugReportOtherLocationWrap");
  const otherLocation = document.getElementById("bugReportOtherLocation");
  const status = document.getElementById("bugReportStatus");
  const submit = document.getElementById("bugReportSubmit");
  const roleSelect = document.getElementById("bugReportRole");
  const cleanLabel = element => (element.textContent || "").replace(/\s+/g, " ").trim();

  function activePortalLocation() {
    const shell = document.getElementById("managementShell");
    if (shell && !shell.hidden) {
      const active = shell.querySelector("[data-tab][aria-current='page']");
      if (active) return `Management — ${cleanLabel(active)}`;
    }
    const director = document.querySelector("[data-director-page].active");
    if (director && currentDirectorAssignment) return `Director portal — ${cleanLabel(director)}`;
    const member = document.querySelector("[data-page].active");
    if (member) return `Trailblazer portal — ${cleanLabel(member)}`;
    return "Sign-in / account access";
  }

  function fillLocations() {
    const values = new Set(["Sign-in / account access"]);
    document.querySelectorAll("[data-page], [data-director-page], #managementNav [data-tab]").forEach(element => {
      const label = cleanLabel(element);
      if (!label) return;
      if (element.dataset.page) values.add(`Trailblazer portal — ${label}`);
      else if (element.dataset.directorPage) values.add(`Director portal — ${label}`);
      else values.add(`Management — ${label}`);
    });
    const current = activePortalLocation();
    if (!values.has(current)) values.add(current);
    locationSelect.replaceChildren(...[...values].map(value => {
      const option = document.createElement("option"); option.value = value; option.textContent = value; return option;
    }));
    const other = document.createElement("option"); other.value = "__other__"; other.textContent = "Other / describe it";
    locationSelect.append(other);
    locationSelect.value = current;
  }

  button.addEventListener("click", () => {
    fillLocations();
    const shell = document.getElementById("managementShell");
    const isManagement = shell && !shell.hidden;
    const isDirector = Boolean(currentDirectorAssignment) && (Boolean(document.querySelector("[data-director-page].active")) || isManagement && document.getElementById("managementTitle")?.textContent.includes("Director"));
    roleSelect.value = isManagement && document.getElementById("managementTitle")?.textContent.includes("Admin") ? "admin_or_other" : isDirector ? "director" : "trailblazer";
    status.textContent = "";
    status.classList.remove("is-error");
    dialog.showModal();
  });

  locationSelect.addEventListener("change", () => {
    const isOther = locationSelect.value === "__other__";
    otherLocationWrap.hidden = !isOther;
    otherLocation.required = isOther;
    if (isOther) otherLocation.focus();
  });
  const close = () => dialog.close();
  document.getElementById("bugReportClose").addEventListener("click", close);
  document.getElementById("bugReportCancel").addEventListener("click", close);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    status.textContent = "Sending report…";
    try {
      const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError || !session) throw new Error("Please sign in to send a bug report.");
      const location = locationSelect.value === "__other__" ? otherLocation.value.trim() : locationSelect.value;
      const { data, error } = await supabaseClient.functions.invoke("submit-bug-report", {
        body: {
          role: roleSelect.value,
          location,
          error_message: document.getElementById("bugReportError").value.trim(),
          description: document.getElementById("bugReportDescription").value.trim()
        }
      });
      if (error) {
        let message = error.message || "The report could not be sent.";
        try { const body = await error.context?.json(); message = body?.error || body?.message || message; } catch {}
        throw new Error(message);
      }
      if (!data?.ok) throw new Error(data?.error || "The report could not be sent.");
      status.textContent = "Thank you. Your bug report was emailed to the portal team.";
      status.classList.remove("is-error");
      form.reset();
      otherLocationWrap.hidden = true;
      setTimeout(() => { if (dialog.open) dialog.close(); }, 2200);
    } catch (error) {
      status.textContent = error.message || "The report could not be sent. Please try again.";
      status.classList.add("is-error");
    } finally {
      submit.disabled = false;
    }
  });
}

initBugReport();


// ==========================================================
// 52. START APPLICATION
// ==========================================================

// Session restoration runs after management.js initializes.
