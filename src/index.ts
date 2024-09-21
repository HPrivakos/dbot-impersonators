import 'dotenv/config'
import Discord, { Intents, TextChannel } from 'discord.js'
import unhomoglyph from './unhomoglyph'
import { allowList, bannedNames, bannedWords, roles } from './config'

const client = new Discord.Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS
  ]
})

let protectedUsers: Discord.GuildMember[] = []
const protectedRoles: string[] = []

void client.login(process.env.DISCORD_API_KEY!).then(async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID!)
  const members = await guild.members.fetch({ force: true })
  const membersList = members.toJSON()
  await Promise.all(
    roles.map((roleId) => addRoleToProtectedList(guild, roleId))
  )

  console.log('Number of protected users:', protectedUsers.length)
  console.log('Number of members:', membersList.length)

  for (const member of membersList) {
    void checkAgainstProtected(member)
  }

  client.on('guildMemberUpdate', (oldMember, newMember) => {
    const newMemberRole = newMember.roles.cache.toJSON()
    const oldMemberRole = oldMember.roles.cache.toJSON()
    const addedRole = newMemberRole.filter((x) => !oldMemberRole.includes(x))
    const removedRole = oldMemberRole.filter((x) => !newMemberRole.includes(x))
    /* If role added to user, add protection */
    if (
      addedRole.map((r) => r.name).length &&
      protectedRoles.includes(addedRole[0].id)
    ) {
      console.log(
        `Adding ${newMember.user.username} to the protected list (role added)`
      )
      protectedUsers.push(newMember)
    }

    /* If role removed from user, remove protection */
    if (
      removedRole.map((r) => r.name).length &&
      protectedRoles.includes(removedRole[0].id)
    ) {
      console.log(
        `Removing ${newMember.user.username} from the protected list (role removed)`
      )
      protectedUsers = protectedUsers.filter((u) => {
        if (u.id == newMember.id) return false
        return true
      })
    }

    /* On nickname change (guild-wide) */
    if (oldMember.nickname != newMember.nickname) {
      const isProtectedUser = !!protectedUsers.find((v) => {
        if (oldMember.id == v.id) return true
        else return false
      })
      if (isProtectedUser) {
        const index = protectedUsers.findIndex((v) => {
          if (oldMember.id == v.id) return true
          else return false
        })
        protectedUsers[index] = newMember
        console.log('New number of protected users:', protectedUsers.length)
      }
    }
  })
  client.on('userUpdate', async (oldUser, newUser) => {
    /* On username change (Discord-wide) */
    if (oldUser.username != newUser.username) {
      console.log('Old name', oldUser.username)
      console.log('New name', newUser.username)

      const isProtectedUser = !!protectedUsers.find((v) => {
        if (oldUser.id == v.id) return true
        else return false
      })
      if (isProtectedUser) {
        const index = protectedUsers.findIndex((v) => {
          if (oldUser.id == v.id) return true
          else return false
        })
        if (index == -1) return
        // User change
        console.log(
          `Changing (old: ${oldUser.username}) ${newUser.username} in the protected list (username changed)`
        )
        protectedUsers[index] = await guild.members.fetch(newUser)
      }
      // Not protected user, pass the new username through the protected list
      else {
        void checkAgainstProtected(await guild.members.fetch(newUser.id))
      }
    }
  })
  client.on('guildMemberAdd', async (newUser) => {
    /* On user join */
    void checkAgainstProtected(newUser)
  })
  client.on('messageCreate', async (msg) => {
    if (msg.channel.type != 'GUILD_TEXT') return
    if (msg.channel.id == '944650179229917185' && !msg.author.bot) {
      if (msg.content.toLowerCase().indexOf('delete-all') !== -1)
        await deleteAll(
          guild,
          msg.content.toLowerCase().replace('delete-all', '').trim()
        )
      if (msg.mentions.members) {
        console.log(msg.mentions.toJSON())
        const list: Discord.GuildMember[] = []
        for (const member of msg.mentions.members.toJSON()) {
          await member
            .ban()
            .then((a) => {
              list.push(a)
            })
            .catch((e) => console.log(e))
          if (msg.content.toLowerCase().indexOf('delete-all') !== -1)
            await deleteAll(guild, member.id)
        }
        if (list.length) {
          await msg.reply(
            `Banned: ${list
              .map(
                (a) =>
                  `<@${a.id}> (\`${a.user.username}#${a.user.discriminator}\`)`
              )
              .join(', ')}`
          )
          await msg.react('✅')
        }
      }
      return
    }
    if (
      msg.content.startsWith('@everyone') &&
      msg.content.toLowerCase().includes('http') &&
      msg.member?.bannable
    ) {
      const guild = await client.guilds.fetch(process.env.GUILD_ID!)
      const logsChannel = (await guild.channels.fetch(
        process.env.LOGS_CHANNEL!
      )) as TextChannel

      await logsChannel.send({
        content: `<@${msg.member.id}> (${
          msg.member.nickname ? `nickname: ${msg.member.nickname}, ` : ''
        }username: ${msg.member.user.username}#${
          msg.member.user.discriminator
        }) was banned for posting a messages starting with (at)everyone.
        \`\`\`${msg.content}\`\`\``
      })

      await msg.member.ban({
        days: 7,
        reason: 'Sent message starting by @everyone'
      })
    }
  })
})

async function addRoleToProtectedList(guild: Discord.Guild, roleId: string) {
  protectedRoles.push(roleId)
  await guild.roles.fetch(roleId).then((r) =>
    r?.members.each((u) => {
      return protectedUsers.push(u)
    })
  )
}

async function banMember(
  scammer: Discord.GuildMember,
  protectedUser: Discord.GuildMember
) {
  console.log('banning', scammer.user.username)

  const guild = await client.guilds.fetch(process.env.GUILD_ID!)
  const logsChannel = (await guild.channels.fetch(
    process.env.LOGS_CHANNEL!
  )) as TextChannel

  if (process.env.ASK_BEFORE_BAN == '1') {
    await logsChannel
      .send({
        content: `<@${scammer.id}> (${
          scammer.nickname ? `nickname: ${scammer.nickname}, ` : ''
        }username: ${scammer.user.username}#${
          scammer.user.discriminator
        }) may be trying to impersonate <@${
          protectedUser.id
        }>, should they get banned?`
      })
      .then(async (m) => {
        await m.react('👍').then(async () => await m.react('👎'))
        await m
          .awaitReactions({
            max: 1,
            time: 120 * 60 * 1000,
            errors: ['time'],
            filter: (_a, b) => b.username !== client.user?.username
          })
          .then(async (collected) => {
            const reaction = collected.first()

            if (!reaction) return
            const user = await reaction.users
              .fetch()
              .then((u) => u.filter((u) => u.id != client.user?.id).first())
            if (reaction.emoji.name === '👎') {
              void m.reply(
                `:no_entry_sign: Not banning <@${scammer.id}> (<@${user?.id}>)`
              )
              return
            }
            if (reaction.emoji.name === '👍') {
              await scammer.ban({
                reason: `Impersonating ${protectedUser.user.username}`,
                days: 7
              })
              void m.reply(
                `:white_check_mark: <@${scammer.id}> was banned (<@${user?.id}>)`
              )
            }
          })
          .catch((e) => {
            console.log(e)
          })
      })
  } else {
    await scammer.ban({
      reason: `Impersonating ${protectedUser.user.username}`,
      days: 1
    })
    const msg = await logsChannel.send(
      `Banned <@${scammer.user.id}> (\`${scammer.user.username}#${scammer.user.discriminator}\`) for impersonating <@${protectedUser.id}> (${protectedUser.user.username}#${protectedUser.user.discriminator})`
    )
    await msg.react('👎')
    await msg
      .awaitReactions({
        max: 1,
        time: 120 * 60 * 1000,
        errors: ['time'],
        filter: (_a, b) => b.username !== client.user?.username
      })
      .then(async (collected) => {
        const reaction = collected.first()

        if (!reaction) return
        if (reaction.emoji.name === '👎') {
          await guild.bans.remove(scammer.user)
          return
        }
      })
      .catch((e) => {
        console.log(e)
      })
  }
}
async function banWord(scammer: Discord.GuildMember, protectedWord: string) {
  console.log('banning', scammer.user.username)

  const guild = await client.guilds.fetch(process.env.GUILD_ID!)
  const logsChannel = (await guild.channels.fetch(
    process.env.LOGS_CHANNEL!
  )) as TextChannel

  if (process.env.ASK_BEFORE_BAN == '1') {
    await logsChannel
      .send({
        content: `<@${scammer.id}> (${
          scammer.nickname ? `nickname: ${scammer.nickname}, ` : ''
        }username: ${scammer.user.username}#${
          scammer.user.discriminator
        }) is using the banned word \`${protectedWord}\`, should they get banned?`
      })
      .then(async (m) => {
        await m.react('👍').then(async () => await m.react('👎'))
        await m
          .awaitReactions({
            max: 1,
            time: 120 * 60 * 1000,
            errors: ['time'],
            filter: (_a, b) => b.username !== client.user?.username
          })
          .then(async (collected) => {
            const reaction = collected.first()

            if (!reaction) return
            const user = await reaction.users
              .fetch()
              .then((u) => u.filter((u) => u.id != client.user?.id).first())
            if (reaction.emoji.name === '👎') {
              void m.reply(
                `:no_entry_sign: Not banning <@${scammer.id}> (<@${user?.id}>)`
              )
              return
            }
            if (reaction.emoji.name === '👍') {
              await scammer.ban({
                reason: `Impersonating ${protectedWord}`,
                days: 1
              })
              void m.reply(
                `:white_check_mark: <@${scammer.id}> was banned (<@${user?.id}>)`
              )
            }
          })
          .catch((e) => {
            console.log(e)
          })
      })
  } else {
    await scammer.ban({ reason: `Impersonating ${protectedWord}`, days: 1 })
    const msg = await logsChannel.send(
      `Banned <@${scammer.user.id}> (\`${scammer.user.username}#${scammer.user.discriminator}\`) for using the banned word \`${protectedWord}\`)`
    )
    await msg.react('👎')
    await msg
      .awaitReactions({
        max: 1,
        time: 120 * 60 * 1000,
        errors: ['time'],
        filter: (_a, b) => b.username !== client.user?.username
      })
      .then(async (collected) => {
        const reaction = collected.first()

        if (!reaction) return
        if (reaction.emoji.name === '👎') {
          await guild.bans.remove(scammer.user)
          return
        }
      })
      .catch((e) => {
        console.log(e)
      })
  }
}

function checkAgainstProtected(member: Discord.GuildMember) {
  if (member.user.id == client.user?.id) return
  if (allowList.includes(member.user.id)) return

  for (const protectedUser of protectedUsers) {
    if (
      unhomoglyph(member.user.username) ==
        unhomoglyph(protectedUser.user.username) &&
      member.user.id != protectedUser.id
    ) {
      console.log(member.user.id, member.user.username)
      console.log(protectedUser.user.id, protectedUser.user.username)
      return banMember(member, protectedUser)
    }
  }
  for (const protectedUser of protectedUsers) {
    if (
      protectedUser.nickname &&
      unhomoglyph(member.user.username) ==
        unhomoglyph(protectedUser.nickname) &&
      member.user.id != protectedUser.id
    ) {
      console.log(member.user.id, member.user.username)
      console.log(protectedUser.user.id, protectedUser.user.username)
      return banMember(member, protectedUser)
    }
  }
  for (const word of bannedWords) {
    if (
      unhomoglyph(member.user.username).includes(unhomoglyph(word)) &&
      !protectedUsers.find((a) => a.user.id == member.user.id)
    )
      return banWord(member, word)
  }
  for (const word of bannedNames) {
    if (
      new RegExp(`\\b${word}\\b`).test(
        unhomoglyph(member.user.username).toLowerCase()
      ) &&
      !protectedUsers.find((a) => a.user.id == member.user.id)
    )
      return banWord(member, word)
    if (
      new RegExp(`\\b${unhomoglyph(word)}\\b`).test(
        unhomoglyph(member.user.username).toLowerCase()
      ) &&
      !protectedUsers.find((a) => a.user.id == member.user.id)
    )
      return banWord(member, word)
  }
}

async function deleteAll(guild: Discord.Guild, userId: string) {
  console.log('delete all from', userId)

  const channels = await guild.channels.fetch()
  for await (const channel of channels) {
    if (!channel[1]) continue
    if (channel[1].type !== 'GUILD_TEXT') continue
    const messages = await channel[1].messages
      .fetch({ limit: 100 })
      .catch(() => {
        return []
      })
    for await (const message of messages) {
      if (message[1].author.id == userId) await message[1].delete()
    }
  }
}
