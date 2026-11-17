// SAE J2012 generic descriptions for common P/U codes. Only codes with a standard meaning are listed.
// A code that is not here stays blank — descriptions are never invented. A description sent with the scan wins.

const GENERIC: Record<string, string> = {
  P0101: "Mass or Volume Air Flow Circuit Range/Performance",
  P0102: "Mass or Volume Air Flow Circuit Low",
  P0103: "Mass or Volume Air Flow Circuit High",
  P0113: "Intake Air Temperature Sensor 1 Circuit High",
  P0117: "Engine Coolant Temperature Sensor 1 Circuit Low",
  P0118: "Engine Coolant Temperature Sensor 1 Circuit High",
  P0122: "Throttle/Pedal Position Sensor A Circuit Low",
  P0123: "Throttle/Pedal Position Sensor A Circuit High",
  P0128: "Coolant Thermostat (Coolant Temperature Below Thermostat Regulating Temperature)",
  P0131: "O2 Sensor Circuit Low Voltage Bank 1 Sensor 1",
  P0133: "O2 Sensor Circuit Slow Response Bank 1 Sensor 1",
  P0134: "O2 Sensor Circuit No Activity Detected Bank 1 Sensor 1",
  P0135: "O2 Sensor Heater Circuit Bank 1 Sensor 1",
  P0137: "O2 Sensor Circuit Low Voltage Bank 1 Sensor 2",
  P0141: "O2 Sensor Heater Circuit Bank 1 Sensor 2",
  P0171: "System Too Lean Bank 1",
  P0172: "System Too Rich Bank 1",
  P0174: "System Too Lean Bank 2",
  P0175: "System Too Rich Bank 2",
  P0300: "Random/Multiple Cylinder Misfire Detected",
  P0325: "Knock Sensor 1 Circuit Bank 1",
  P0335: "Crankshaft Position Sensor A Circuit",
  P0340: "Camshaft Position Sensor A Circuit Bank 1",
  P0401: "Exhaust Gas Recirculation Flow Insufficient Detected",
  P0420: "Catalyst System Efficiency Below Threshold Bank 1",
  P0430: "Catalyst System Efficiency Below Threshold Bank 2",
  P0442: "Evaporative Emission System Leak Detected (small leak)",
  P0455: "Evaporative Emission System Leak Detected (large leak)",
  P0456: "Evaporative Emission System Leak Detected (very small leak)",
  P0500: "Vehicle Speed Sensor A",
  P0506: "Idle Air Control System RPM Lower Than Expected",
  P0507: "Idle Air Control System RPM Higher Than Expected",
  P0700: "Transmission Control System (MIL Request)",
  U0073: "Control Module Communication Bus A Off",
  U0100: "Lost Communication With ECM/PCM A",
  U0101: "Lost Communication With TCM",
  U0121: "Lost Communication With Anti-Lock Brake System Control Module",
  U0140: "Lost Communication With Body Control Module",
  U0155: "Lost Communication With Instrument Panel Cluster Control Module",
};

/** Cylinder misfire P0301–P0312 is defined by SAE J2012 (P0301 = cylinder 1). */
function misfire(code: string) {
  const match = /^P03(\d{2})$/.exec(code);
  if (!match) return "";
  const cylinder = Number(match[1]);
  if (cylinder >= 1 && cylinder <= 12) return `Cylinder ${cylinder} Misfire Detected`;
  return "";
}

/** Use the scanner's description when it sent one. Otherwise a known generic description, or "". */
export function codeDescription(code: string, provided = "") {
  const given = String(provided || "").trim();
  if (given) return given;
  const normalized = String(code || "").toUpperCase();
  return GENERIC[normalized] || misfire(normalized);
}
