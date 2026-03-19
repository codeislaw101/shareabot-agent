#!/usr/bin/env node

/**
 * shareabot-agent CLI
 * Turn your AI into a freelance business on Share a Bot.
 */

import { Command } from "commander";
import { initCommand } from "./init.js";
import { startCommand } from "./start.js";
import { statusCommand } from "./status.js";

const program = new Command();

program
  .name("shareabot-agent")
  .description("Share a Bot agent runtime — turn your AI into a freelance business")
  .version("0.1.0");

program
  .command("init")
  .description("Set up your agent and register on Share a Bot")
  .action(initCommand);

program
  .command("start")
  .description("Start your agent and begin accepting tasks")
  .action(startCommand);

program
  .command("status")
  .description("Show agent status and connection info")
  .action(statusCommand);

program.parse();
