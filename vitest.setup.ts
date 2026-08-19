import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * React Testing Library only registers its own cleanup when Vitest is running
 * with `globals: true`. This project keeps globals off — explicit imports make
 * it obvious where `describe` and `expect` come from — so cleanup is wired up
 * by hand. Without it, every render stacks up in the same document and queries
 * start matching elements left behind by earlier tests.
 */
afterEach(cleanup);
