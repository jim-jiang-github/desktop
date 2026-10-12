import assert from 'node:assert/strict'
import { it } from 'node:test'
import * as React from 'react'
import { DropdownItemType } from '../../../src/ui/toolbar/push-pull-button'
import { PushPullButtonDropDown } from '../../../src/ui/toolbar/push-pull-button-dropdown'
import { fireEvent, render, screen } from '../../helpers/ui/render'

it('offers force push alongside fetch and invokes the existing lease-protected action', () => {
  let forcePushCount = 0
  let fetchCount = 0
  render(
    <PushPullButtonDropDown
      itemTypes={[DropdownItemType.Fetch, DropdownItemType.ForcePush]}
      remoteName="origin"
      askForConfirmationOnForcePush={true}
      fetch={() => fetchCount++}
      forcePushWithLease={() => forcePushCount++}
    />
  )

  assert.ok(screen.getByRole('button', { name: /Fetch origin/ }))
  assert.equal(forcePushCount, 0)
  fireEvent.click(screen.getByRole('button', { name: /Force push origin/ }))
  assert.equal(forcePushCount, 1)
  assert.equal(fetchCount, 0)
})
