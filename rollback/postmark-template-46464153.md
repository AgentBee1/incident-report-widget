# Backup: Postmark template 46464153 "Kudos Email - Agents" (before 21 Oct 2026)

Server: AgentBee (19233012) · Layout: `agentbee-kudos` · Stream: `kudos-notifications-agents`

To restore: Postmark → AgentBee server → Templates → "Kudos Email - Agents" → Edit,
paste the two bodies below back in, Save.

## Subject

```
Your award from {{issuing_institution}}
```

## HTML body

```html
<p>Hi Team,</p>

<p>Congratulations on your award from <strong>{{issuing_institution}}</strong>.</p>

<p>We've added it to our Kudos awards database so institutions and students can find it more easily when searching for good agents.</p>

<p style="text-align: center; margin: 32px 0;">
  <a href="https://agentbee.net/kudos/" style="background-color: #fed04b; color: #000000; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">See your award on AgentBee Kudos</a>
</p>

<p>Regards,<br>
The AgentBee Team</p>
```

## Text body (note: this was leftover from a comment-notification template)

```
{{body}}

{{#attachment_details}}

{{#each . }}

{{attachment_name}} ( {{ attachment_url }} ) ({{attachment_size}} {{attachment_type}})

{{/each}}

{{/attachment_details}}

By {{commenter_name}} at {{timestamp}}

View the comment ( {{ action_url }} ) or Manage notifications ( {{ notifications_url }} )
```
