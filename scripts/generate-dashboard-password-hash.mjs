#!/usr/bin/env node
import process from "node:process";
import { hashDashboardPassword } from "./dashboard-auth.mjs";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const password = Buffer.concat(chunks).toString("utf8").replace(/[\r\n]+$/, "");
if (!password) {
  console.error("Read the dashboard password from standard input; received an empty value.");
  process.exitCode = 1;
} else {
  console.log(await hashDashboardPassword(password));
}
