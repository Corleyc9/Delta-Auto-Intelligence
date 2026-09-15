"use client";

import { useDashboard } from "@/app/dashboard-context";

export default function ScheduleHistoryView() {
  const {
    scheduleSnapshots,
    scheduleDate,
    setScheduleDate,
    setScheduleSnapshotId,
    scheduleCaptureBusy,
    scheduleCaptureMessage,
    scheduleDates,
    activeScheduleDate,
    dayScheduleSnapshots,
    selectedScheduleSnapshot,
    refreshScheduleHistory,
    requestScheduleCapture,
  } = useDashboard();
  return (
    <section className="schedule-history-page">
            <div className="page-heading schedule-history-heading">
              <div>
                <p className="panel-kicker">HOURLY RECORD</p>
                <h2>Schedule History</h2>
                <p>Archived from Tekmetric every hour from 7:00 AM through 7:00 PM. Records are retained for 30 days.</p>
              </div>
              <div className="schedule-history-actions">
                <label>Date
                  <select value={activeScheduleDate} onChange={(event) => {
                    setScheduleDate(event.target.value);
                    const first = scheduleSnapshots.find((item) => item.scheduleDate === event.target.value);
                    setScheduleSnapshotId(first?.id ?? null);
                  }}>
                    {scheduleDates.map((date) => <option value={date} key={date}>{new Date(`${date}T12:00:00`).toLocaleDateString()}</option>)}
                  </select>
                </label>
                <button className="schedule-capture-now" disabled={scheduleCaptureBusy} onClick={requestScheduleCapture}>
                  {scheduleCaptureBusy ? "Sending…" : "Take Snapshot Now"}
                </button>
                <button onClick={() => refreshScheduleHistory()}>Refresh records</button>
              </div>
            </div>
            {scheduleCaptureMessage && <p className="schedule-capture-message">{scheduleCaptureMessage}</p>}
            {dayScheduleSnapshots.length ? (
              <>
                <div className="schedule-hour-picker" aria-label="Archived schedule times">
                  {dayScheduleSnapshots.slice().reverse().map((snapshot) => (
                    <button className={selectedScheduleSnapshot?.id === snapshot.id ? "active" : ""} key={snapshot.id} onClick={() => setScheduleSnapshotId(snapshot.id)}>
                      {snapshot.hourLabel}
                    </button>
                  ))}
                </div>
                {selectedScheduleSnapshot && (
                  <>
                    <div className="schedule-record-meta">
                      <strong>{new Date(`${selectedScheduleSnapshot.scheduleDate}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · {selectedScheduleSnapshot.hourLabel}</strong>
                      <span>{selectedScheduleSnapshot.appointments.length} scheduled item{selectedScheduleSnapshot.appointments.length === 1 ? "" : "s"} · captured {new Date(selectedScheduleSnapshot.capturedAt).toLocaleString()}</span>
                      {selectedScheduleSnapshot.screenshotAvailable && <a className="schedule-view-image" target="_blank" rel="noreferrer" href={`/api/schedule-history/image?date=${encodeURIComponent(selectedScheduleSnapshot.scheduleDate)}&hour=${encodeURIComponent(selectedScheduleSnapshot.hourKey)}`}>View Screenshot</a>}
                    </div>
                    <div className="schedule-record-grid">
                      {(selectedScheduleSnapshot.employees.length ? selectedScheduleSnapshot.employees : Array.from(new Set(selectedScheduleSnapshot.appointments.map((item) => item.employee)))).map((employee) => {
                        const employeeAppointments = selectedScheduleSnapshot.appointments
                          .filter((item) => item.employee === employee)
                          .sort((a, b) => a.startTime.localeCompare(b.startTime));
                        return <section className="schedule-employee" key={employee}>
                          <header><strong>{employee}</strong><span>{employeeAppointments.length}</span></header>
                          <div>
                            {employeeAppointments.map((item, index) => <article key={`${item.startTime}-${index}`} style={{ borderLeftColor: item.color || undefined }}>
                              <time>{item.startTime}{item.endTime ? ` – ${item.endTime}` : ""}</time>
                              <p>{item.text.replace(new RegExp(`${item.startTime}\\s*-\\s*${item.endTime}`, "i"), "").trim()}</p>
                            </article>)}
                            {!employeeAppointments.length && <p className="schedule-empty">Nothing scheduled</p>}
                          </div>
                        </section>;
                      })}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="empty-leads schedule-no-records"><strong>No schedule records yet</strong><p>The reader will create the first record during the next hourly scan between 7:00 AM and 7:00 PM.</p></div>
            )}
          </section>
  );
}
