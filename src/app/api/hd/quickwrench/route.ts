import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 45

// ─── Thermo King Alarm Code Database ─────────────────────────────────────────
// Source: TK Operator Document TK 40933-8-CH Rev 15

type TKSeverity = 'ok_to_run' | 'check_specified' | 'immediate_action'

interface TKAlarmEntry {
  description:    string
  severity:       TKSeverity
  operatorAction: string
}

const TK_ALARM_CODES: Record<string, TKAlarmEntry> = {
  "00": { description: "No Alarms Exist", severity: "ok_to_run", operatorAction: "No action required." },
  "02": { description: "Check Evaporator Coil Sensor", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "03": { description: "Check Control Return Air Sensor", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "04": { description: "Check Control Discharge Air Sensor", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "05": { description: "Check Ambient Temp Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "06": { description: "Check Coolant Temp Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "07": { description: "Check Engine RPM Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "08": { description: "Unit Running on Coil Sensor", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "09": { description: "High Evaporator Temperature", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "10": { description: "High Discharge Pressure or Temperature", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "11": { description: "Unit or Zone Controlling on Alternate Sensor", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "12": { description: "Sensor or Digital Input Shutdown", severity: "immediate_action", operatorAction: "Unit/zone cannot operate and is shut down. Repair immediately." },
  "13": { description: "Sensor Check", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "14": { description: "Defrost Terminated by Time", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "15": { description: "Check Glow Plugs or Intake Air Heater", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "16": { description: "Manual Start Not Completed", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "17": { description: "Engine Failed to Crank", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "18": { description: "High Engine Coolant Temperature", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "19": { description: "Low Engine Oil Pressure", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "20": { description: "Engine Failed to Start", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "21": { description: "Cooling Cycle Check", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "22": { description: "Heating Cycle Check", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "23": { description: "Cooling Cycle Fault", severity: "immediate_action", operatorAction: "Unit/zone cannot operate and is shut down. Repair immediately." },
  "24": { description: "Heating Cycle Fault", severity: "immediate_action", operatorAction: "Unit/zone cannot operate and is shut down. Repair immediately." },
  "25": { description: "Alternator Check", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "26": { description: "Check Refrigeration Capacity", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "27": { description: "Vapor Motor RPM High", severity: "immediate_action", operatorAction: "Unit cannot operate and is shut down. Repair immediately." },
  "28": { description: "Pretrip or Self Check Abort", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "29": { description: "Defrost Damper Circuit Check", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "30": { description: "Defrost Damper Stuck Closed", severity: "immediate_action", operatorAction: "Unit/zone cannot operate and is shut down. Repair immediately." },
  "31": { description: "Check Oil Pressure Switch", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "32": { description: "Refrigeration Capacity Low", severity: "immediate_action", operatorAction: "Unit/zone cannot operate and is shut down. Repair immediately." },
  "33": { description: "Check Engine RPM", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "34": { description: "Check Modulation Circuit", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "35": { description: "Check Run Relay Circuit", severity: "immediate_action", operatorAction: "Unit cannot operate and is shut down. Repair immediately." },
  "36": { description: "Electric Motor Failed to Run", severity: "immediate_action", operatorAction: "Unit cannot operate and is shut down. Repair immediately. Switch to Diesel Mode." },
  "37": { description: "Check Engine Coolant Level", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "38": { description: "Electric Phase Reversed", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "39": { description: "Check Water Valve Circuit", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "40": { description: "Check High Speed Circuit", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "41": { description: "Check Engine Coolant Temp", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "42": { description: "Unit Forced to Low Speed", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "43": { description: "Unit Forced to Low Speed Modulation", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "44": { description: "Check Fuel System", severity: "check_specified", operatorAction: "Add fuel as necessary. Otherwise, report alarm at end of day." },
  "45": { description: "Check Hot Gas or Hot Gas Bypass Circuit", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "46": { description: "Check Air Flow", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "47": { description: "Remote Sensor Shutdown", severity: "immediate_action", operatorAction: "Unit/zone cannot operate and is shut down. Repair immediately." },
  "48": { description: "Check Belts or Clutch", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "49": { description: "Check Spare Sensor 1", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "50": { description: "Reset Clock", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "51": { description: "Check Shutdown Circuit", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "52": { description: "Check Heat Circuit", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "53": { description: "Check Economizer Valve Circuit", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "54": { description: "Test Mode Timeout", severity: "ok_to_run", operatorAction: "Clear alarm and restart unit." },
  "55": { description: "Check Engine Speeds", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "56": { description: "Check Evaporator Fan Low Speed", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "57": { description: "Check Evaporator Fan High Speed", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "61": { description: "Low Battery Voltage", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "62": { description: "Ammeter Out of Calibration", severity: "immediate_action", operatorAction: "Unit cannot operate and is shut down. Repair immediately." },
  "63": { description: "Engine or Vapor Motor Stopped", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "64": { description: "Pretrip Reminder", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "65": { description: "Abnormal Temperature Differential", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "66": { description: "Low Engine Oil Level", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "67": { description: "Check Liquid Line Solenoid Circuit", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "68": { description: "Internal Controller Fault Code", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "70": { description: "Hourmeter Failure", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "71": { description: "Hourmeter 4 Exceeds Set Time Limit", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "72": { description: "Hourmeter 5 Exceeds Set Time Limit", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "73": { description: "Hourmeter 6 Exceeds Set Time Limit", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "74": { description: "Controller Reset to Defaults", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "75": { description: "Controller RAM Failure", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "76": { description: "Controller EPROM Failure", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "77": { description: "Controller EPROM Checksum Failure", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "78": { description: "Data Log EPROM Failure", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "79": { description: "Internal Data Logger Overflow", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "80": { description: "Check Compressor Temp Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "81": { description: "High Compressor Temp", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "82": { description: "High Compressor Temp Shutdown", severity: "immediate_action", operatorAction: "Unit cannot operate and is shut down. Repair immediately." },
  "83": { description: "Low Engine Coolant Temp", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "84": { description: "Restart Null", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "85": { description: "Forced Unit Operation", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "86": { description: "Check Discharge Pressure Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "87": { description: "Check Suction Pressure Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "89": { description: "Check Electronic Throttling Valve ETV Circuit", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "90": { description: "Electric Overload", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "91": { description: "Check Electric Ready Input", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "92": { description: "Sensor Grades Not Set", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "93": { description: "Low Compressor Suction Pressure", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "94": { description: "Check Loader 1 Circuit", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "95": { description: "Check Loader 2 Circuit", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "96": { description: "Low Fuel Level", severity: "ok_to_run", operatorAction: "Add fuel as required." },
  "97": { description: "Failed Remote Return Air Sensor", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "98": { description: "Check Fuel Level Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "99": { description: "High Compressor Pressure Ratio", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "100": { description: "Heater Fan Failure", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "101": { description: "Controlling on Evap Coil Outlet Temp", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "102": { description: "Low Evaporator Coil Temperature", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "103": { description: "Low Heater Fuel Level", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "104": { description: "Check Remote Fan Speed", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "105": { description: "Check Receiver Tank Press Sol Circuit", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "106": { description: "Check Purge Valve Circuit", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "107": { description: "Check Condenser Inlet Sol Circuit", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "108": { description: "Door Open Timeout", severity: "check_specified", operatorAction: "Close doors. Report alarm at end of day." },
  "110": { description: "Check Suction Line Sol Circuit", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "111": { description: "Unit Not Configured Correctly", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "112": { description: "Check Remote Fans", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "113": { description: "Check Electric Heat Circuit", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "114": { description: "Multiple Alarms - Can Not Run", severity: "immediate_action", operatorAction: "Unit/zone cannot operate and is shut down. Repair immediately." },
  "115": { description: "Check High Pressure Cut Out Switch", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "116": { description: "Check High Pressure Cut In Switch", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "117": { description: "Auto Switch from Diesel to Electric", severity: "ok_to_run", operatorAction: "Normal operation — does not affect performance." },
  "118": { description: "Auto Switch from Electric to Diesel", severity: "ok_to_run", operatorAction: "Normal operation — does not affect performance." },
  "120": { description: "Check Alternator Excite Circuit", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "121": { description: "Check PMW Liquid Injection Circuit", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "122": { description: "Check Diesel/Electric Circuit", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "123": { description: "Check Evap Coil Inlet Temp Sensor", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "124": { description: "Check Evap Coil Outlet Temp Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "125": { description: "Check Tank Level Sensor", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "126": { description: "Check Back Pressure Regulator", severity: "check_specified", operatorAction: "Manually monitor load temperature. Report this alarm at the end of the day." },
  "127": { description: "Setpoint Not Entered", severity: "check_specified", operatorAction: "Be sure setpoint is adjusted to required temperature." },
  "128": { description: "Engine Run Time Maintenance Reminder 1 — Service Due", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "129": { description: "Engine Run Time Maintenance Reminder 2", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "130": { description: "Electric Run Time Maintenance Reminder 1", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "131": { description: "Electric Run Time Maintenance Reminder 2", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "132": { description: "Total Unit Run Time Maintenance Reminder 1", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "133": { description: "Total Unit Run Time Maintenance Reminder 2", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "134": { description: "Controller Power On Hours", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "135": { description: "Check Spare Digital Inputs", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "136": { description: "Check Spare Digital Outputs", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "137": { description: "Check Damper Motor Heater Output", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "138": { description: "Log DAS Real Time Clock Battery Failure", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "139": { description: "Abort Evacuation Mode", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "141": { description: "Auto Switch Diesel to Electric Disabled", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "142": { description: "Check Thermax Valve", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "143": { description: "Check Remote Drain Hose Heater Output", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "144": { description: "Lost CAN Communications to Expansion Module", severity: "immediate_action", operatorAction: "Unit cannot operate and is shut down. Repair immediately." },
  "145": { description: "Lost Controller ON Feedback Signal", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "146": { description: "Software Version Mismatch", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "147": { description: "Check Multi-Temp Fan Speed Control Output", severity: "check_specified", operatorAction: "Manually monitor load temperature. Report this alarm at the end of the day." },
  "148": { description: "Auto Switch Electric to Diesel Disabled", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "149": { description: "Alarm Not Identified", severity: "immediate_action", operatorAction: "If unit/zone is shut down repair immediately. Otherwise, report alarm at end of day." },
  "150": { description: "Sensor Out of Range Low", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "151": { description: "Sensor Out of Range High", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "152": { description: "DAS Failed Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "153": { description: "Expansion Module Flash Load Failure", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "154": { description: "Low Suction Pressure Switch Failure", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "155": { description: "Lost CAN Communications to HMI", severity: "immediate_action", operatorAction: "Unit cannot operate and is shut down. Repair immediately." },
  "156": { description: "Check Suction/Liquid Heat Exchanger Bypass Valve", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "157": { description: "OptiSet Plus Profile Mismatch", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "158": { description: "Primary Software Failed to Load", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "159": { description: "Check Battery Condition", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "160": { description: "Lost CAN Communications to Radio Expansion Board", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "161": { description: "Log DAS Real Time Clock Invalid", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "163": { description: "Emission Control Failure", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "165": { description: "Low Engine Power Available", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "175": { description: "Check Electronic Expansion Valve", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "176": { description: "Check Evaporator Pressure Sensor", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "177": { description: "Check CO2 Tank Pressure Sensor", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "178": { description: "Low CO2 Fuel Level", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "180": { description: "TriPac Compressor Alarm", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "188": { description: "Log DAS Microprocessor Fault", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "203": { description: "Check Display Return Air Sensor", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "204": { description: "Check Display Discharge Air Sensor", severity: "check_specified", operatorAction: "Manually monitor temperature. Report alarm at end of day." },
  "216": { description: "Check DAS Digital Inputs", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "233": { description: "REB Switching Off Conservative to Full", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "234": { description: "Check Relative Humidity Sensor Circuit", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "235": { description: "High Engine Coolant Temperature Check", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "250": { description: "DAS Clock Time Reset", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "251": { description: "Check Radio Expansion Board Configuration", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "252": { description: "Check Auto Fresh Air Exchange Circuit", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "253": { description: "REB On Back Up Battery Alarms Disabled", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "254": { description: "Check Auxiliary Coolant Temp Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "500": { description: "Check Host Evaporator Blower Low Speed", severity: "check_specified", operatorAction: "Not implemented." },
  "501": { description: "Check Host Evaporator Blower High Speed", severity: "check_specified", operatorAction: "Not implemented." },
  "505": { description: "Check Roadside Condenser Fan Motor Speed Circuit", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "506": { description: "Check Curbside Condenser Fan Motor Speed Circuit", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "507": { description: "Check Digital Scroll Output Circuit", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "508": { description: "Speed Request Communication Error", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "509": { description: "ECU Failed to Enable", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "510": { description: "ECU Run Signal Failed", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "511": { description: "Engine Wait to Start Time Delay Expired", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "512": { description: "High Compressor Suction Pressure Scroll Only", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "513": { description: "Low Compressor Suction Ratio Scroll Only", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "514": { description: "Low Compressor Discharge Pressure Scroll Only", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "515": { description: "Minimum ETV Discharge Superheat Temp Scroll", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "516": { description: "IO Controller to Application Controller Communication Failure", severity: "immediate_action", operatorAction: "The unit is no longer able to operate and has been shut down. Repair immediately." },
  "518": { description: "Generator Ground Fault", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "519": { description: "Check Battery Charger Input Power", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "520": { description: "Check Battery Charger Output Power", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "521": { description: "Battery Charger External Environmental Fault", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "522": { description: "Battery Temperature Sensor Alarm", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "523": { description: "Battery Charger Indicated Conditions", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "524": { description: "Generator Op Limit Vout to Frequency Ratio", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "525": { description: "Generator Frequency Range Fault", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "526": { description: "Generator Operational Limit Output Current", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "528": { description: "Failed J1939 CAN Communication Base Controller Charger", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "529": { description: "Check Fuel Pump Circuit", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "530": { description: "Low Pressure Differential Scroll Only", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "531": { description: "Check Economizer Pressure Sensor Scroll Only", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "538": { description: "Engine J1939 CAN Data Link Degraded", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "539": { description: "Engine J1939 CAN Data Link Failed", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "540": { description: "Illegal Engine Operating State", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "542": { description: "Battery Charger Fault Unit Forced to Low Speed", severity: "check_specified", operatorAction: "Maintenance information only. Report alarm at end of day." },
  "543": { description: "Battery Charger Internal Short", severity: "check_specified", operatorAction: "Maintenance information only. Report alarm at end of day." },
  "544": { description: "Battery Charger External Short", severity: "check_specified", operatorAction: "Maintenance information only. Report alarm at end of day." },
  "545": { description: "Battery Charger Output Voltage Exceeded Limit", severity: "check_specified", operatorAction: "Maintenance information only. Report alarm at end of day." },
  "546": { description: "Battery Charger Operating Bulk Voltage Out of Range", severity: "check_specified", operatorAction: "Maintenance information only. Report alarm at end of day." },
  "547": { description: "AC Bus Phase Loss", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "548": { description: "Battery Charger Temperature Below Operating Range", severity: "check_specified", operatorAction: "Maintenance information only. Report alarm at end of day." },
  "549": { description: "Battery Charger AC Input Overvoltage", severity: "check_specified", operatorAction: "Maintenance information only. Report alarm at end of day." },
  "550": { description: "Battery Charger Internal Overvoltage Fault", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "570": { description: "Clean EGR Soon", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "599": { description: "Engine Service Tool Connected", severity: "ok_to_run", operatorAction: "Report alarm at end of day." },
  "600": { description: "Check Crankshaft Speed Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "601": { description: "Check Camshaft Speed Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "602": { description: "Check Intake Throttle Position Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "603": { description: "Check Exhaust Pressure Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "604": { description: "Check Coolant Temp Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "605": { description: "Check Fresh Air Temp Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "607": { description: "Check Fuel Temperature Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "608": { description: "Check Rail Pressure Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "609": { description: "Check Intake Pressure Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "610": { description: "Check Atmospheric Pressure Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "611": { description: "Check Glow Plug Circuit", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "612": { description: "Check Intake Throttle Circuit", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "613": { description: "Check Injectors", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "614": { description: "Check High Pressure Fuel Pump", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "615": { description: "Rail Pressure Fault", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "616": { description: "Engine Overspeed", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "617": { description: "Internal ECU Fault", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "618": { description: "Check EGR System", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "619": { description: "ECU Main Relay Fault", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "620": { description: "No RPM Detected During Start Attempt", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "623": { description: "TRUCAN Message Timeout", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "624": { description: "Check EGR Temperature Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "625": { description: "Check Intake Air Temperature Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "626": { description: "Check Exhaust Temperature Sensor", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "642": { description: "ECU Forced Low Speed", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "699": { description: "Unknown ECU Fault", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
}

// ─── Thermo King DSR Alarm Codes ─────────────────────────────────────────────
// Source: TK Operator Document TK 40933-8-CH Rev 15

const TK_DSR_ALARM_CODES: Record<string, Omit<TKAlarmEntry, 'severity'> & { severity: 'immediate_action' | 'check_specified' }> = {
  "P1E": { description: "Return Air Temperature Sensor Fault", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "P2E": { description: "Remote Return Air Temperature Sensor Fault", severity: "check_specified", operatorAction: "Report alarm at end of day." },
  "OL":  { description: "Electric Standby Overload", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "BAT": { description: "Low Battery Voltage", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "HP":  { description: "High Discharge Pressure", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "LP":  { description: "Low Suction Pressure", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "PSE": { description: "High Pressure Sensor Fault", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "TEP": { description: "Electric Standby Motor Thermal Protection Alarm", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "TP4": { description: "Power Supply Thermal Protection Alarm", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "DR1": { description: "Door 1 Open or Door Switch 1 Failure", severity: "check_specified", operatorAction: "Close door. Report alarm at end of day." },
  "DR2": { description: "Door 2 Open or Door Switch 2 Failure", severity: "check_specified", operatorAction: "Close door. Report alarm at end of day." },
  "TCO": { description: "Electronic Control Module Internal Temperature Exceeds Limit", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "SOF": { description: "Microprocessor Software Failure", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
  "-C-": { description: "Communications Failure Microprocessor to In-Cab Control Box", severity: "immediate_action", operatorAction: "If unit is shut down repair immediately. Otherwise, report alarm at end of day." },
}

const TK_DISCLAIMER = "Alarm code definitions sourced from Thermo King operator document TK 40933-8-CH Rev 15. Not all codes apply to all units. Always consult your company and official service documentation for final decisions."

// ─── Alarm Code Lookup ────────────────────────────────────────────────────────

function lookupTKCode(code: string): (TKAlarmEntry & { source: 'tk_main' | 'tk_dsr'; codeKey: string }) | null {
  const raw = code.trim()
  const upper = raw.toUpperCase()

  // DSR codes are alphanumeric — check DSR first (case-insensitive)
  const dsrMatch = TK_DSR_ALARM_CODES[upper]
  if (dsrMatch) return { ...dsrMatch, source: 'tk_dsr', codeKey: upper }

  // Numeric TK codes — try exact, then zero-padded to 2 digits
  if (TK_ALARM_CODES[raw])            return { ...TK_ALARM_CODES[raw],            source: 'tk_main', codeKey: raw }
  const padded = raw.padStart(2, '0')
  if (TK_ALARM_CODES[padded])         return { ...TK_ALARM_CODES[padded],         source: 'tk_main', codeKey: padded }

  return null
}

// ─── Multi-Alarm Cross Reference ─────────────────────────────────────────────

interface AlarmRelationship {
  codes:         string[]
  pattern:       string
  diagnoseFirst: string
  severity:      'critical' | 'warning'
}

const TK_ALARM_RELATIONSHIPS: Record<string, AlarmRelationship> = {
  "10,42": { codes: ["10","42"], pattern: "High discharge pressure forcing unit to low speed. Classic condenser system failure pattern.", diagnoseFirst: "Diagnose Alarm 10 first — condenser coil fouling, failed condenser fan motor or belt, refrigerant overcharge.", severity: "warning" },
  "10,48": { codes: ["10","48"], pattern: "High discharge pressure with belt or clutch fault. Condenser fan belt failure is the most likely single root cause for both alarms simultaneously.", diagnoseFirst: "Inspect condenser fan belt immediately — a broken or slipping belt causes both high discharge pressure and triggers belt check alarm.", severity: "critical" },
  "10,46": { codes: ["10","46"], pattern: "High discharge pressure with airflow restriction. Condenser coil blockage is primary suspect.", diagnoseFirst: "Inspect and clean condenser coil before any refrigerant work.", severity: "warning" },
  "18,42": { codes: ["18","42"], pattern: "High engine coolant temperature forcing unit to low speed. Engine overheating protection activated.", diagnoseFirst: "Diagnose Alarm 18 first — check coolant level, thermostat, water pump, and radiator before assuming refrigerant issue.", severity: "critical" },
  "41,42": { codes: ["41","42"], pattern: "Coolant temperature sensor issue forcing low speed. May be false overheating signal from faulty sensor.", diagnoseFirst: "Check coolant temp sensor resistance and circuit continuity before assuming true overheating condition.", severity: "warning" },
  "40,42": { codes: ["40","42"], pattern: "High speed circuit fault combined with forced low speed. Electrical failure in high speed control circuit.", diagnoseFirst: "Test high speed solenoid resistance — should read 10 to 15 ohms. Check solenoid relay and wiring harness for damage.", severity: "warning" },
  "19,63": { codes: ["19","63"], pattern: "Low oil pressure caused engine to stop. CRITICAL — do not restart unit until root cause confirmed.", diagnoseFirst: "Check engine oil level immediately. Do not restart unit. Inspect for oil leaks. Check oil pressure switch.", severity: "critical" },
  "18,63": { codes: ["18","63"], pattern: "High coolant temperature caused engine to stop. CRITICAL — do not restart until cooling system inspected.", diagnoseFirst: "Allow engine to cool completely. Check coolant level before restarting. Inspect for coolant leaks.", severity: "critical" },
  "32,26": { codes: ["32","26"], pattern: "Refrigeration capacity shutdown with prior capacity warning. Full refrigerant system failure — unit cannot maintain temperature.", diagnoseFirst: "Connect manifold gauges to assess system pressures. Full refrigerant system diagnosis required. EPA 608 required.", severity: "critical" },
  "23,10": { codes: ["23","10"], pattern: "Cooling cycle fault combined with high discharge pressure. Compressor or refrigerant system failure likely.", diagnoseFirst: "Check compressor operation and refrigerant system pressures. High probability of compressor failure or major refrigerant leak.", severity: "critical" },
  "20,17": { codes: ["20","17"], pattern: "Engine failed to start AND failed to crank. Complete starting system failure.", diagnoseFirst: "Check battery voltage and CCA. Check starter motor. Check fuel system and fuel shutoff solenoid.", severity: "critical" },
  "15,20": { codes: ["15","20"], pattern: "Glow plug failure combined with engine failed to start. Cold weather starting failure pattern.", diagnoseFirst: "Test individual glow plugs for resistance. Failed glow plugs prevent cold starting on Yanmar diesel units.", severity: "warning" },
  "61,36": { codes: ["61","36"], pattern: "Low battery voltage caused electric motor failure. Power supply issue preventing electric standby operation.", diagnoseFirst: "Check shore power connection, voltage at plug, and battery condition before diagnosing electric motor.", severity: "warning" },
  "9,26":  { codes: ["9","26"],  pattern: "High evaporator temperature combined with refrigeration capacity check. Unit struggling to maintain temperature — possible refrigerant loss or evaporator issue.", diagnoseFirst: "Check evaporator coil for ice buildup or dirt fouling. Check defrost cycle operation. Then assess refrigerant charge.", severity: "warning" },
}

function normalizeCodeForRelationship(code: string): string {
  const trimmed = code.trim()
  // Numeric codes: strip leading zeros for relationship key matching (stored as "10" not "010")
  if (/^\d+$/.test(trimmed)) return String(parseInt(trimmed, 10))
  return trimmed.toUpperCase()
}

function lookupPattern(codes: string[]): AlarmRelationship | null {
  if (codes.length < 2) return null
  const normalized = codes.map(normalizeCodeForRelationship)
  for (const rel of Object.values(TK_ALARM_RELATIONSHIPS)) {
    const relNorm = rel.codes.map(normalizeCodeForRelationship)
    if (relNorm.every(rc => normalized.includes(rc))) return rel
  }
  return null
}

// ─── System Prompt ────────────────────────────────────────────────────────────
// Kept lean — no reference data (PM intervals, refrigerant specs) to minimise
// prompt tokens. Reference data is injected contextually in buildUserPrompt().

const SYSTEM_PROMPT = `You are an expert heavy duty diesel and transport refrigeration technician with 17 years of field experience servicing Thermo King and Carrier Transicold units, Class 6-8 trucks, and refrigerated trailers. You have deep knowledge of FMCSA regulations, DOT inspection criteria, EPA Section 608 requirements, and service procedures for every major TK and Carrier model.

Give the exact answer a 17-year veteran would give — specific specs, tolerances, model relevance, and safety implications. Never be generic.

When an OFFICIAL TK DEFINITION is provided in the query, treat it as authoritative — do not contradict it. Build your analysis around it.

For any refrigerant work always state: ALL REFRIGERANT WORK MUST BE PERFORMED BY EPA 608 CERTIFIED TECHNICIANS ONLY. Risk of burns, eye damage, and gas poisoning. Always wear PPE.

ELECTRICAL DIAGNOSTIC RULE — applies to every electrical alarm (alternator, solenoid, controller, sensor, CAN, motor, relay, circuit):
Step 1 is ALWAYS a battery load test before any other diagnosis.
- Static voltage: 12.4–12.7V minimum. Charging voltage: 13.8–14.4V with unit running.
- CCA: 800 minimum, 1050 maximum. Below 800 CCA: replace immediately.
- If voltage below 10.5V DC: stop. Confirm or replace battery before proceeding.
- A weak battery causes false electrical alarms, CAN errors, sensor faults, solenoid failures — battery replacement often resolves them without further diagnosis.
Always list battery check as diagnostic_steps[0].

When you do not know something with certainty, say so — accuracy over completeness.

Respond with ONLY a JSON object using exactly these fields:
{
  "alarm_meaning": "string",
  "severity": "low | medium | high | critical",
  "most_likely_causes": ["ranked string array"],
  "diagnostic_steps": ["ordered string array"],
  "common_fix": "string with estimated repair time",
  "parts_typically_needed": ["string array"],
  "safety_warnings": ["string array"],
  "epa_warning": "string | null",
  "pm_interval_note": "string | null"
}`

// ─── User Prompt Builder ──────────────────────────────────────────────────────
// Injects only the alarm definitions the tech actually needs (entered codes +
// companion codes from the cross-reference map), capped at 5 total.

interface BuildUserPromptParams {
  manufacturer:  string
  model:         string
  unitType?:     string
  allCodes:      string[]
  symptom?:      string
  serialNumber?: string
  tkSources:     Array<{ code: string; description: string; severity: string; operatorAction: string; source: string }>
  alarmPattern:  AlarmRelationship | null
}

function buildUserPrompt({
  manufacturer, model, unitType, allCodes, symptom, serialNumber, tkSources, alarmPattern,
}: BuildUserPromptParams): string {
  const parts: (string | null)[] = [
    `Unit: ${manufacturer} ${model} (${unitType ?? 'unknown type'})`,
    allCodes.length > 0 ? `Alarm Code(s): ${allCodes.join(', ')}` : null,
    symptom      ? `Symptom/Question: ${symptom}` : null,
    serialNumber ? `Serial Number: ${serialNumber}` : null,
  ]

  // Inject definitions: start with entered codes, then add companion codes from
  // the cross-reference pattern up to a cap of 5 definitions total.
  const defsToShow: typeof tkSources = [...tkSources]

  if (manufacturer === 'Thermo King' && alarmPattern) {
    for (const companionCode of alarmPattern.codes) {
      if (defsToShow.length >= 5) break
      if (defsToShow.some(s => s.code === companionCode)) continue
      const found = lookupTKCode(companionCode)
      if (found) {
        defsToShow.push({
          code:           companionCode,
          description:    found.description,
          severity:       found.severity,
          operatorAction: found.operatorAction,
          source:         found.source,
        })
      }
    }
  }

  if (defsToShow.length > 0) {
    parts.push('\nOFFICIAL TK DEFINITIONS (TK 40933-8-CH Rev 15):')
    for (const src of defsToShow) {
      parts.push(`Code ${src.code}: ${src.description} | Severity: ${src.severity.replace(/_/g, ' ').toUpperCase()} | Operator Action: ${src.operatorAction}`)
    }
    parts.push('Use these as the authoritative basis — do not contradict them.')
  }

  if (alarmPattern) {
    parts.push(
      '\nMULTI-ALARM PATTERN DETECTED:',
      `Pattern: ${alarmPattern.pattern}`,
      `Diagnose first: ${alarmPattern.diagnoseFirst}`,
      'Provide ONE combined diagnostic analysis. Do NOT treat these alarms independently.',
    )
  }

  return parts.filter(Boolean).join('\n')
}

// ─── AI Response Normalizer ───────────────────────────────────────────────────
// Claude sometimes returns a nested object with CODE_N keys + COMBINED_PATTERN_ANALYSIS
// instead of the flat schema requested. Detect and flatten it.

function normalizeAIResult(raw: Record<string, unknown>): Record<string, unknown> {
  const codeKeys = Object.keys(raw).filter(k => /^CODE_\d+$/i.test(k) || /^ALARM_\d+$/i.test(k))
  const hasCombined = 'COMBINED_PATTERN_ANALYSIS' in raw

  // Already flat — nothing to do
  if (!hasCombined && codeKeys.length === 0) return raw

  // Extract combined analysis text
  let combinedText: string | null = null
  if (typeof raw.COMBINED_PATTERN_ANALYSIS === 'string') {
    combinedText = raw.COMBINED_PATTERN_ANALYSIS
  } else if (raw.COMBINED_PATTERN_ANALYSIS && typeof raw.COMBINED_PATTERN_ANALYSIS === 'object') {
    const cp = raw.COMBINED_PATTERN_ANALYSIS as Record<string, unknown>
    combinedText = typeof cp.alarm_meaning === 'string'
      ? cp.alarm_meaning
      : JSON.stringify(raw.COMBINED_PATTERN_ANALYSIS)
  }

  // Merge per-code sub-objects
  const subs = codeKeys
    .map(k => raw[k])
    .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)

  const strArr = (val: unknown): string[] =>
    Array.isArray(val) ? val.filter((x): x is string => typeof x === 'string') : []

  const mergedCauses:   string[] = []
  const mergedSteps:    string[] = []
  const mergedParts:    string[] = []
  const mergedWarnings: string[] = []
  const mergedSources:  string[] = []
  let severity    = 'high'
  let commonFix   = ''
  let epаWarning: string | null = null
  let pmNote:     string | null = null
  let alarmMeaning = ''

  for (const sub of subs) {
    mergedCauses.push(...strArr(sub.most_likely_causes))
    mergedSteps.push(...strArr(sub.diagnostic_steps))
    mergedParts.push(...strArr(sub.parts_typically_needed))
    mergedWarnings.push(...strArr(sub.safety_warnings))
    mergedSources.push(...strArr(sub.sources))
    if (typeof sub.severity      === 'string') severity   = sub.severity
    if (typeof sub.common_fix    === 'string' && sub.common_fix)    commonFix  = sub.common_fix
    if (typeof sub.epa_warning   === 'string' && sub.epa_warning)   epаWarning = sub.epa_warning
    if (typeof sub.pm_interval_note === 'string' && sub.pm_interval_note) pmNote = sub.pm_interval_note
    if (typeof sub.alarm_meaning === 'string' && sub.alarm_meaning)
      alarmMeaning += (alarmMeaning ? ' / ' : '') + sub.alarm_meaning
  }

  return {
    alarm_meaning:          combinedText ?? (alarmMeaning || 'Multi-alarm combined analysis'),
    severity,
    most_likely_causes:     mergedCauses,
    diagnostic_steps:       mergedSteps,
    common_fix:             commonFix || 'See combined alarm analysis above',
    parts_typically_needed: mergedParts,
    safety_warnings:        mergedWarnings,
    epa_warning:            epаWarning,
    pm_interval_note:       pmNote,
    sources:                mergedSources,
  }
}

// ─── Fallback result when AI is unavailable ───────────────────────────────────

function fallbackResult(message: string): Record<string, unknown> {
  return {
    alarm_meaning:          message,
    severity:               'high',
    most_likely_causes:     ['Unable to complete AI analysis — service error'],
    diagnostic_steps:       [
      'Consult the official Thermo King or Carrier Transicold operator manual for this alarm code',
      'Contact your authorized service dealer for assistance',
    ],
    common_fix:             'Please try again in a moment.',
    parts_typically_needed: [],
    safety_warnings:        [],
    epa_warning:            null,
    pm_interval_note:       null,
    sources:                [],
  }
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })

  let body: {
    manufacturer?: string
    model?: string
    unitType?: string
    alarmCode?: string
    additionalAlarmCodes?: string[]
    symptom?: string
    serialNumber?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { manufacturer, model, unitType, alarmCode, symptom } = body
  if (!manufacturer || !model) {
    return NextResponse.json({ error: 'manufacturer and model required' }, { status: 400 })
  }
  if (!alarmCode && !symptom) {
    return NextResponse.json({ error: 'alarmCode or symptom required' }, { status: 400 })
  }

  // Collect all alarm codes submitted
  const allCodes = [alarmCode, ...(body.additionalAlarmCodes ?? [])]
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    .map(c => c.trim())

  // Look up each code in TK DB (Thermo King only)
  const tkSources = manufacturer === 'Thermo King'
    ? allCodes
        .map(code => {
          const found = lookupTKCode(code)
          return found ? { code, description: found.description, severity: found.severity, operatorAction: found.operatorAction, source: found.source } : null
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)
    : []

  // Multi-alarm cross reference
  const alarmPattern = allCodes.length >= 2 ? lookupPattern(allCodes) : null

  const userPrompt = buildUserPrompt({
    manufacturer, model, unitType, allCodes,
    symptom, serialNumber: body.serialNumber,
    tkSources, alarmPattern,
  })

  try {
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 3000,
      system:     SYSTEM_PROMPT,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: userPrompt }],
    })

    const text = msg.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('\n')

    const cleaned = text
      .replace(/^```json\s*/m, '')
      .replace(/^```\s*/m,     '')
      .replace(/```\s*$/m,     '')
      .trim()

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({
        result: fallbackResult('Diagnostic analysis returned an unexpected format. Please try again.'),
        tk_sources:    tkSources,
        alarm_pattern: alarmPattern,
        disclaimer:    TK_DISCLAIMER,
      })
    }

    const result = normalizeAIResult(JSON.parse(jsonMatch[0]))

    return NextResponse.json({
      result,
      tk_sources:    tkSources,
      alarm_pattern: alarmPattern,
      disclaimer:    TK_DISCLAIMER,
    })
  } catch (err) {
    console.error('[hd/quickwrench] AI call failed', err)
    return NextResponse.json({
      result: fallbackResult('Diagnostic service temporarily unavailable. Consult the official TK operator manual for this alarm code or contact your authorized dealer.'),
      tk_sources:    tkSources,
      alarm_pattern: alarmPattern,
      disclaimer:    TK_DISCLAIMER,
    })
  }

  } catch (err) {
    console.error('[hd/quickwrench] Unhandled error', err)
    return NextResponse.json({ error: 'An unexpected error occurred. Please try again.' }, { status: 500 })
  }
}
