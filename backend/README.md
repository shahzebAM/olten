<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

## Attendance aggregation and payroll snapshots

The API and payroll interface use `src/employees/attendance-calculator.ts` for integer-minute calculations. Separate same-day sessions are retained; identical sessions and overlapping minutes count once. Unpaid breaks and the attendance regular-hours limit apply to the scheduled workday. Cutoff dates are inclusive attendance start dates in Asia/Manila; an overnight session starting on the final date keeps its full duration. Attendance retains its daily regular/overtime breakdown. Payroll applies the selected calculation method described below. Existing tax formulas remain in effect.

Deploy the additive `20261016000000_attendance_aggregation_snapshots` migration with `npx prisma migrate deploy` before starting the updated backend. It adds nullable attendance break-policy fields and a nullable payroll calculation snapshot. It does not update existing attendance hours, payroll amounts, or historical snapshots. New payroll requests must include `cutoffStart` and `cutoffEnd`; the backend calculates hours and earnings from current source records and saves the breakdown for later reports. Historical payrolls without a snapshot retain their saved amounts and show unavailable hour/pay breakdowns instead of reconstructing them from current attendance or salary.

For review of stale stored attendance hours, use authenticated `GET /employees/attendance/audit-lunch?company=COMPANY`. This is read-only; normal attendance reads already return corrected derived hours without changing stored source records. `POST /employees/attendance/recalculate-lunch` with `{"company":"COMPANY","recordIds":[123],"dryRun":true}` previews selected corrections. Only after reviewing the audit and taking a backup should an authorized operator explicitly set `dryRun:false` with the selected IDs. This optional operation updates attendance hours only; it never recalculates saved payroll. Re-importing source CSVs skips identical employee/date/punch sessions and preserves distinct sessions; corrections to a source session use its explicit edit action.

## Automatic payroll pay profiles

Deploy `20261017000000_employee_payroll_profile` with `npx prisma migrate deploy` before starting this version. It adds nullable `Employee.payrollProfile` JSONB without changing existing employee fields, attendance, or saved payrolls. Each employee needs a one-time agreed pay profile in Compute Payroll: a fixed daily rate with scheduled working weekdays (or fixed paid days), or the existing cutoff salary with a fixed divisor and the same required paid-day count. New setups default to the existing cutoff salary divided by 14 paid days, matching the supplied workbook; existing explicit rate/day settings are retained. Daily rates do not change with attendance counts; scheduled paid days come from the selected 26th–10th or 11th–25th calendar cutoff shared with Attendance Logs.

Payroll now defaults to the user-requested Excel cutoff balance method (`overtimeBasis: CUTOFF_NET`, also the default when omitted): required hours = paid days × 8, overtime = positive total paid hours minus required hours, shortfall = positive required hours minus total paid hours. Overtime is paid at 125% of the full hourly rate; shortfalls at 100%. Only money amounts are rounded to cents; displayed decimal hours/rates are not reused as inputs. `DAILY` remains an explicit per-profile alternative that keeps each workday’s overtime and regular-hour shortfall separate. This configurable workbook reconciliation method is not a certification of statutory wage compliance. Punches remain hours/minutes only, so seconds-based Excel totals may differ; exact agreement requires identical paid minutes and pay settings.

`POST /employees/payroll/preview` reads current employee, attendance and shift settings without saving payroll. The UI requires a configured profile and a fresh preview before finalization. Confirmed saves compare the preview fingerprint and read sources/create the payroll in one serializable transaction; changed sources return HTTP 409 for review. New snapshots use version 2 and retain the calculation method, profile, required paid days and source counts. Historical saved payrolls retain their original amounts. Lunch deductions, tax formulas, and manual holiday adjustments remain unchanged. The Excel method needs no additional database migration.
