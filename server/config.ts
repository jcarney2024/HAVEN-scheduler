export type Config = {
  haveNManagementBaseId: string;
  allPeopleTableId: string;
  su26RosterTableId: string;
  su26ScheduleTableId: string;
  su26RemovalLogTableId: string;
  directorAppsBaseId: string;
  directorAppsTableId: string;
  directorAppsStaffTableId: string;
  volunteerAppsBaseId: string;
  volunteerAppsTableId: string;
  volunteerAppsStaffTableId: string;
};

export function loadConfig(): Config | null {
  const required = {
    haveNManagementBaseId: process.env.HAVEN_MGMT_BASE_ID,
    allPeopleTableId: process.env.ALL_PEOPLE_TABLE_ID,
    su26RosterTableId: process.env.SU26_ROSTER_TABLE_ID,
    su26ScheduleTableId: process.env.SU26_SCHEDULE_TABLE_ID,
    su26RemovalLogTableId: process.env.SU26_REMOVAL_LOG_TABLE_ID,
    directorAppsBaseId: process.env.DIRECTOR_APPS_BASE_ID,
    directorAppsTableId: process.env.DIRECTOR_APPS_TABLE_ID,
    directorAppsStaffTableId: process.env.DIRECTOR_APPS_STAFF_TABLE_ID,
    volunteerAppsBaseId: process.env.VOLUNTEER_APPS_BASE_ID,
    volunteerAppsTableId: process.env.VOLUNTEER_APPS_TABLE_ID,
    volunteerAppsStaffTableId: process.env.VOLUNTEER_APPS_STAFF_TABLE_ID,
  };
  for (const v of Object.values(required)) {
    if (!v) return null;
  }
  return required as Config;
}
