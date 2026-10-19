import { readFileSync } from 'fs'
import { resolve } from 'path'

/** The recorded `docker ps` output from bento, in the current format (ports and compose project). */
export function recordedDockerPs(): string {
  return readFileSync(resolve('tests/fixtures/docker-ps-stacks.txt'), 'utf-8')
}
