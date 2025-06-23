import { createConsola } from "consola";

const level = process.env.DEBUG === "1" ? 4 : 3;

const logger = createConsola({
  level,
});

export default logger;
