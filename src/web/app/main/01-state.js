
/* =====================================================================
   活点地图 canvas.html — 高保真交互原型
   数据 → 渲染:state(S) 是唯一事实源;render() 全量重建世界层。
   ===================================================================== */

/* ---------- 图标 ---------- */
const I = {
  hand:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7.5 15.5c-2 0-3.4-1.2-4.1-3.2l-.9-2.6c-.2-.5.1-1.1.6-1.3.5-.1 1 .1 1.2.6l.5 1.3V5.2a.9.9 0 0 1 1.8 0V4a.9.9 0 0 1 1.8 0v.8a.9.9 0 0 1 1.8 0v5c0 .4.5.5.7.2l.8-1.1c.3-.4.9-.5 1.3-.2.4.3.5.8.3 1.2l-1.6 2.9c-.8 1.6-2.2 2.7-4.2 2.7Z" stroke-linejoin="round"/></svg>',
  node:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="9" r="5.5"/></svg>',
  edge:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 14 13 4.5M10.5 4h3v3"/></svg>',
  ann:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3.5h12v8H8l-3.5 3v-3H3v-8Z" stroke-linejoin="round"/></svg>',
  md:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 2.5h7l3 3v8H3v-11Z"/><path d="M10 2.5v3h3"/></svg>',
  trash:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 5h12M7 5V3.5h4V5M5 5l.8 9.5h6.4L13 5" stroke-linejoin="round"/></svg>',
  route:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 15c4-1 2-8 6-9s3-2 6-3" stroke-linecap="round"/><circle cx="3" cy="15" r="1.6"/><circle cx="15" cy="3" r="1.6"/></svg>',
  paste:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4.5" y="4.5" width="10" height="11" rx="1.5"/><path d="M7 4.5V3h4v1.5" stroke-linejoin="round"/></svg>',
  eye:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8S4 4 8 4s6.5 4 6.5 4-2.5 4-6.5 4S1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="1.8"/></svg>',
  eyeoff:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2.5 2.5l11 11M6.5 4.6A6.8 6.8 0 0 1 8 4.5c4 0 6.5 3.5 6.5 3.5a13 13 0 0 1-2.3 2.4M9.6 11.3A6.4 6.4 0 0 1 8 11.5C4 11.5 1.5 8 1.5 8a13 13 0 0 1 2.9-2.8"/></svg>',
  check:'<svg class="check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m3 8.5 3.5 3.5L13 4.5"/></svg>',
  x:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m4 4 8 8M12 4l-8 8"/></svg>',
  ext:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 3h7v7M13 3 7 9M5 5H3v8h8v-2" stroke-linejoin="round"/></svg>',
  folder:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h3l1.5 2h4.5A1.5 1.5 0 0 1 14 7.5v4A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-6Z"/></svg>',
  gear:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="9" cy="9" r="2.4"/><path d="M9 1.8v2.2M9 14v2.2M1.8 9H4M14 9h2.2M3.9 3.9l1.6 1.6M12.5 12.5l1.6 1.6M14.1 3.9l-1.6 1.6M5.5 12.5l-1.6 1.6"/></svg>',
  fit:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 6V2h4M12 2h4v4M16 12v4h-4M6 16H2v-4"/></svg>',
  tidy:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h12M5 9h8M7 14h4" stroke-linecap="round"/></svg>',
  imp:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13.5h10" stroke-linejoin="round"/></svg>',
  exp:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 10V2M4.5 5.5 8 2l3.5 3.5M3 13.5h10" stroke-linejoin="round"/></svg>',
  plus:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 3v10M3 8h10"/></svg>',
  save:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 2.5h7l3 3v8H3v-11Z"/><path d="M5.5 2.5V6h4V2.5M5 13.5v-4h6v4" stroke-linejoin="round"/></svg>',
  img:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="5.5" cy="6.5" r="1.2"/><path d="m2.5 11.5 3-3 2.5 2.5 2-2 3 3" stroke-linejoin="round"/></svg>',
  app:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 5.5h12"/></svg>',
  terminal:'<svg viewBox="0 0 16 16" width="16" height="16"><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAADiklEQVR4AeyVOUtkQRCAa55XYqKBgWZGJgqzqYg7gcYKJoJgoj9ig0U2UVdEEwMDEUVFMDR3RsQDvGYED1A8UEQEDzAQwWO2voKSN7PHaCQsDn5UdXV1VXX16zaQD/59FvDZgY/vwPr6+nclriRyMTw8nHgLXV1dic7OzlzEOzo6vtOBH3oTY8rXXEQika9vgThv8Iupzw8KiOiCD/nTAiLB/Py8zCuJREKyicfjEmZvb0+c3d1d+RM7OztyenoqNzc3v3F9fS3ZBJ40XIQnZc71ubm5jOQUEi6AxA4F3N7evhbgSSnK9aurKwGOQNLptME5uI58eXkxO3p4znWX4fn32gJPgnx+fpbi4mJpaWkx0LE7JALGYRnWfe6ttowOUEBra6s0NjZKQ0ODtLW1SUVFhYSDEth36RKbE7a57hIf110GGB0SnZycyMPDg1BMdXW1tLe3S01NjY3dLyw9kEvmwjpj+JvNCvBJ5OzsrAwNDcn9/b3tvLy83DoRi8UyisCXwOC6y/fYrAB2zmK9lwjRF1G6u7vtK356epKioiJpbm6WpqYmwQd/IBG47vI9NiuArCwieBAEUlBQIMfHxzIwMCDn5+e2c46kvr5e6urqrDP4ZyP6+5dNp+1WucQ38EFYUkhJSYlUVlba3d/f35fHx0fZ3t62x8d3KvojiAoLHNb/ZGPe8XnrgBtdlpaW2i2oqqqybpydncnMzIxMTk7aK8diwD9bYnN8jrHrLt1mBbiRnZWVldlZI+lEYWGh7ZpX8e7uTvLz8+07IAD+fCMcj0t0x234AWvA86FbAUwCC2pra5m3lvOc8hSnUilLzPdBUSzEd2RkRKanp2Vqasq6MzExIePj4zI2Niajo6MGPtwg4rMOXEdaAWRkAtjp4eGhHB0dCe//wcGBHUNeXl7Gztkl6ygkF8QlGRJY59IK8AG7u7i4kMXFRVlaWpLLy0tL7jtnYZi+vj67rj09PdLb22tgg/7+foHBwUFZW1t7/UjJBcRBUoDKNGPbITvlEQI/bwrDQR0tEDpsbW1JMpmUzc1NkxwVY+xh+C+Iv+NxVKYp4KcqSSWliQzdcQoY66KUts/AB7BpoSlH343Uv8CPWKwF1qtMatyfwcLCwjflixIFbX9U25/B8vJyNJuVlZXo6upqVNubgb6iUWdjY+NVd5tLnfui3fpmD5FW9GF/nwX8/x3I9XH9AgAA//+HXtBQAAAABklEQVQDABrcFoz1w2odAAAAAElFTkSuQmCC" width="16" height="16"/></svg>',
  vscode:'<svg viewBox="0 0 16 16" width="16" height="16"><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAFAElEQVR4AbRXfUyVVRj/nXO5osOpYGrLZuVHbaWGaNb6wHJz+UUpTNbHf9WAfyC3FvjB8k5CKULjozaa/7ISMhHKwUZUuJwjJ/JRWx8uo4xhhg1WXO7HOf0OL8TLve+9sLi+nOee857ze57f73nOy3nvlbgV175zibOOnG9cfOKnG6sahmpWfDSwOhJNzAXMOfj5UsT523zDwzuv9/YuFEK8IBPcXSvrB08v//ivDaFCYiugsPU+r8DXgF4NTSplPjQEIKRL7HLFu9pXnhlquufUzVSMXTET4N7X8hC0Pqe1vos9NegxIxOHRpDQFCLwdJw77qtV9YNty2sH1sRGwIGWLX6pW6HVImg9Rmz1Ibejy0YMhHhCul2nZyzAdaD5OWj1KYPOpZF8IuOp7oWQK2YkQBY05wY1akg5KyIzCxFNyISAY13LUfH9gww2rSb3NxcpIcoZXMKpzuNzU0SzBJT1ZMAV9y1UoAPHusvh6WFGETw9Wsr85mqlUEhiQQERk4cWw5iyAse/ewVSnoTSswkWEDIP80Ub3u1ZFiYh92w8/mmqU9BZJCcxo49nGt7/6Hbh0fDpyW6mfJXQyoXJyIeh0IHS7h3/icg9Ow+zRRM00kOwkyNaceowrDb4ird0ToU1ApoZlEFIxYRs4yRI0YCyrhKY0y0eXxL0JA2RDSNcy0PptkxUbh8kcMomMde7h6gPbcSMwRlLDAXKAsxNvALpWhcBY+EVriIQSEXp9krYLqsghDCe01gie4Mfrz3wIpTiVkRAxbnjsXAJwM6xpNCNcKsUHE9rt3FbQ4aMJlxaKB6S+WvzOC6kaUcH4QISFwEJ82zpwA+oAryz41mU7LxJ3/A2PQFjfq+vKUZQZ/Mu4JipCZYwH1hAIUJeQyC4GWVpbxNvVtg5NLMSxcYqYHPs+wUYuM7E6MXmWI1Zc4Db7gTuWGZz/H/DyQL2NhxkmGp4/47DQD9FKDgKMMKApYBsxZGufPoIWlgTQvDlyBDEOz2AZm5MgBZ4tcEcq28Sbp1uPi/wZx8QDHAqQgSl3Vx8C8WdZ3C0KzFMgZmga8QkuCaRVe0mOV8omg8hZ+zogI/bYUQER+zTYWMgDUpfgufyRsM5yUyaUUwifkktH7jnaUyGAiaDFQL+EnjlCga9FAEz7nc33KINRZdziZ12M1uwNSwj6iDZAHTwGVTs2o/i5GvwDz/FqF84Y7lifJSO56gChztq4bnA/9dxbZF7CRXMJVmQZkPhAkb861CZ8RkDWs3zyCD6E7ZBi1PWRJRPIfZAzv4GnvZkGGFRTOK9jBPcv0wK8BJMqC5Hv28TPsjsDaOoXDUCtTYTSlUTbxNs3EIM+l5I93nGJI6RuOw0NlsAvJ/+CUTgfgT0OlSl70VdJp8+Ojk1j1A4lJIDLYqgR/+iEcwhIto6LAGGqCrzZ1Snd5rhtOxQ8hvQKg9ah2wfU7U9yLyLqmFCwLRYQ0Ce9VVQmi8yMRKVJYqKmQkweg6vPwmpd0KJIWcRZLdVhBXjllhzSukrMxdgRHhSWliJzbQ/7ATWmADyhYpT/BGj/N7dsRFADhSnXETQ9TgUrtrJQri10qp5xOfb1PtSYupv2bd3x04AeB1N/oGn4WPMvJvGUnOOCvhG0iqg6n0+/8bel5O29uUsbuPKaIutABPSk/I73K5UfolqXJC08AZTrvEF1Zpfs5J29+UsumggdvsXAAD///v8/TcAAAAGSURBVAMABz+nVInCTrkAAAAASUVORK5CYII=" width="16" height="16"/></svg>',
  antigravity:'<svg viewBox="0 0 16 16" width="16" height="16"><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAFQklEQVR4AbRWiU9URxz+5u3ugwXxIGgLUkBZAbUeaZtU41E8kGAaS9PGHkmr1qZnTP8DK6jYJqaNppEmNmlN08YDUBuradNaSjjS2FKDUEHELkaW00JZ9mAX3nR+b5dl2Z0HJIWX/b2Z+R3f972ZebNPQdiVkZExf6ktp2iJLeeHpZk53Utty/mMmMDSMQU2cYRRIiQgPTOrgJljmwB2kIHtAGOLMFOXwNIxCVtwENcYtC4gw5aTb2KmqyIpZSwwWy1xENeYCCUtLW0B4/hytgiNcBWmfJGauiJRMZvj9zDGko0SZ8tPM6Gq/HWFM6ybLokQClW1IDY2FlardYKRT1VVsXXYdOFA3LQHJhUQFxeHF194Hqc+O4GL5edwqeICKkRbXnYW4Ua+SxXn9ZzSUyfxysu7QbVTqFmnMIZ0o6SkpCSc+PQ4jpUcRn5+HlatehzZ2VnIzlomNxGjnB1521FcdFCvTUk2Xl3iphmQ8pP6Y0eLsWXLM1AUeRrXRsD9w9J6qqHaEoERHx8nzSGnHFlEdhbkIzd3s3RNOefw9NRg8Mp+uEv3YuR6ObjPJ6om/hhj2LBhPQqf2zUxEDYyFLB1S67hk3u8XWhuPokHA39jYKAbrvOnMfJ7TRjseJdmgpZk3DOxZyggJcV47W50XEO9JxZ/WZbjXsIy9MYlwVl2DprLNRE9OEp9bLF0JiksFWCxWMTrplI8yoZ8g/jpQQuahnNwi69Bo7oWbQnL4fDEwHWjPiqfHKrAs1jM1I0yqQCaNiE5Kpkcf3S34u6/qbC7VqDVuxpNWItG6xNombsa9j/vg2scsktRTDL3+J9ReJQx+WEyqmn4pX0Afc4s9Dtt6PVk4L4/A7dN2WhMWIMGz6MY6neHQwX6Ao8xOaZ0BgJV0fdulxctPfFwOdPhdT+CIU8i/vEtQAcWoU1NR0vMEnT0jUYXTuKZtgB69e70edE3kARteCFS5iRg37oYHNgag8zFVjw0zcM9LETrQzM0g2WQ6Zi2gFGxtLe6gEHnPEEej492WfDWBgUvPcVwpFDB+mwz+rgVDd0WDHllVHKfInPT00b63T6Ohg4G7o/HexstsC1kYp8yPW1+HMM7uUz8OSmo71DQ4xRq9UjwxjlkmBQ1EKBBVFA8ZK29I2jtMiPXZsH2HFOIfCwhaU5ARL+X4fsGQBOkYzFqNbGBqY00qQCfzw9f2NHa5RzF6To/MhNj8O4mUyRGaLxpGbAxi+Gq+LD7tQXiGQIz4fP74RcWSgzrSAVQvLNLLLjoOL0azvzmh9NjFlNvhvh+El75z2pheHszYFvEUFoFNAcg4OhwhMREVhoKqKqqBk2bJr4aViebcbxQxZNpCkxKYN0jgWhMr/ri+Qyf7GZ49WnAqkLH+Pl6JYWlZijg8ndXUFlZhbmxQMFKM5LnGRNHIseYgcI14kMjEaipqcOFsvLIlNDYUIDb7caHhw6jurpWf4pQxTQ7NHtUe6joCFwuyekYxFHEZu0O9qMaR2cn3j/wAQiEwOzt7XA4HAETMYqHLOinnNraOhwt+VivpXEUcNBB3AoYvxkcSxtS/823Z7Fn35vYnrcT2/IKkJf/LHZEGPm2iTjlvLZnP7468/WkT66TCW6xpSYXoCcGb3SY+MQr6vV64fF4Jhj5fOLVpZxg+pSNONZuKtoI+1xMxcCU2TOcQJzErdjtzXYNeGOG8aeE40zbS9wKZba33b44ykd3ihPbQePZNOIgLvvdlsvEowugTnvbnWt8xLsS4MUi6UdxdPWQ//+aXs95j45J2IKDuHQ/gP8AAAD//xXDGpMAAAAGSURBVAMA5B4u0QMU2BUAAAAASUVORK5CYII=" width="16" height="16"/></svg>',
  defaultApp:'<svg viewBox="0 0 16 16" width="16" height="16"><image href="data:image/png;base64,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" width="16" height="16"/></svg>',
  gitBash:'<svg viewBox="0 0 16 16" width="16" height="16"><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAADwUlEQVRYha2XX2hbVRzHPyfJujrBuWJhG2UOxJdqZTKnDgSRKmPYoWx2CN3obLWr1kq3PTgFc3rShzHFf5QaG4Q1zCLbVISlzIKPg42xItu0OBBhL5nd6Jzb2qWLyc+HZMlNc25yb9jv7Z577+/zud9fcnKjRISaypjtwAfAHWAIrRO1tFE1CUQibyMyAqj8SgalOgmHx/22CtwDOEAQkTiRSIffdv4SMKYZuIC7uO8k/CSg0Hoapd4F3Kx9J+EtAWO6gNeArWidchmDszwnUT2BSKQb+AbYDPyEMfWEw1GU6uMeJFFZIBZbAnRSfNJNJRLB4KNACxB3kXjh2PT2ukoI1xGYBG+i2Nh/dnhPA9cmgOccp8fReoezD8acBp52rB2Kts7sSy2fn8jCyL6WMes4rAlEErwFxBC6htf3f3GNhpeBk45LViy6RYDT5fDbJ0SxUSnin17YZR1HmYCZoEdglGLsb1gknsSYZYtuPVcOl2fya0E3iZIRmAl6EL7G/uk+1D81POAYx4/ATrSeLzYwL0ZbZ6YWwZ2VEaHTOY5CApHj7K4Ah/IktgJr8uCDGBNC618WHphrdYFbkwgAmAS9oohWgNskJgurgcDcV89fqY9N7V4y8ET8e+AdBecRktUklElIuwhHPMCLJRzUW9iPMfVonQL47LddJxFmbwbn23Xz0TsAw3++tzSdujECdFu6ZEBeVYPH5VdgnWd4ruYIslpv5gbAl7/v2JCR0JmcnPTubYmP3r3w44vdq0PpzCUgZOlzJkDu99xv3eIWqbsHKVShhwoU1wHuC94/C9y0NRGoCyAMARlfeEVYbzDLuG4eBHj/scPngASAiOo1mMKH+7+Ff1+nfN8AkAAcUCJCJEGH5LbToAf4Hv3U0Cmy2UngWVbpP0gOfnI4+Nfg1avBH0A2gVyCwBiKdYi0WfoK0Lf38bFoACDcxrjK7fmVkyiFLy+uqy07s4+MNjZmtoGaBPUwiEbklUpwcOwDVSXK4VcIcT1/Ngl0lEpYqwReIlBRwvbkGV6iUf8NQHrpNmC+ikQZvEzAKmGDK07RpM8Xblqz/x8UR/JHNgkr3CrglMjCgHXmQhMcK52tsNZxVJBQon52g0O1V7LL5iGEiygaLLd+yIJ8ztrmNMnpdhTfWTp8G0smu3rWj6bdENXfCS9HOkDcvqKzwG2gyXJOUKqPlWHrk3sXqC5hK09w8Ppavio8Dqr6PuET7l3Au4QvuD+B6hK+4f4F3CVqgkOt/44BZkwbWT4C6lAcYKU+Wkub/wH7ctrWAEPPtQAAAABJRU5ErkJggg==" width="16" height="16"/></svg>',
  pycharm:'<svg viewBox="0 0 16 16" width="16" height="16"><image href="data:image/png;base64,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" width="16" height="16"/></svg>',
  folderOfficial:'<svg viewBox="0 0 16 16" width="16" height="16"><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAARGSURBVFhH7ZTZc1NlGIf7VzhN0tbiFKjAnRc6w6ijiAsK1A3FBeuC4oqIO0srbiguuKAy43ihTAVK26mFtE3R3qJd0n1P0ybdW1SgbdpSz+O83/lOenJyHC/wzr4z7+QqeX7L9yYlZXEWRw/Vl+UZ1akYv6Tyl+zPsh7mT3u4eNqrdi7gCc8FfLnO7/4nI2C9xrwGzwu4yty5gI+5Kq8xG0hj1u/JcX7/kifRsXYt4CofF6sE7jNmK9OYqUwjVpH2e6w8NdP5G5c0pmPT9ZwCe5kNmM5nAz7lfKYyXQQYsYp0psvNnfJnMO3PMCb9GUyeyjAunLycyVOZxvmyTM6fXMK5MtlM48+flvBHqewVsnlOfoq4NYFeY6bSq536xC3T5T6my9OYUsB0YtVXY/Tuh6HvYPBbGDgMA19B5HOIfAr9H0P/hxB+D8LvQG8+9OyGnjeh+1ViZ3Jw8lMu+D3GRKnHGC32MFbiNUaLvcZwkY/hE16GCr2MFPmMkZIspmpyMaICOwj9H0Df+9BngfaZsNBe6N2jga8rKN2vQNdO6NoBndtdBDTshLMVMOGHiTIYL4WxYhgrgtFjMFIAw9/D4GHo/wj69tscanBvHoT2QGgXdL8B3a+Z8K6Xoesl6HwROl6AjueSBTB61Pzxga9h4BAMfAlRifQgRD4xoRKrgMV1+F0Ivw29b0FIwHuhZxf0CNhybYF3xMF0PAPt21wEDH5j9hjV4KgFlj4PQJ+OOw7eZwNb/Wpwl45bwJ3boeN56HhWgWl/EtqecBEQPQTRLyD6mfmQInawS9wCDu2GkAWWuBN7VuB2AT8N7U8pMK2PQWuumwABW64P2OLW4IS45YFZcf9zzwvgrdD2OLQ+Ci2PQMvDLgL+rWf1wKye7XHbeu4UsMRt9kybGbfp2gTT/CA0b3YR4NqzHax7Vq6Tz8qtZwVWjrfEwTTfB033ughQYCtue8/6rOJxW2BxbQfbelZx52rwQ9D8ADTfD02boPFuaLzTRUDSA9M9x+9ZwLaeVdzSs8Tt7HmLjlvAmzX4Hmi8CxpyoGGDi4B43PYH5nLPyrUFtnoWsBX3Qs80mXHHwcENELwDgutcBFhnpXq2PzC5Z+24U85Kgx1nldBzHGzGrcAN66F+HdTfCnU3uwhIOCvHAxNwQs9bNVjHbfXcJD1rsIp6IwTXQ/D2OJi6m6BujYuApJ4FnPj3aYJ1z/Gzcum5UeK2wLdB/S1QtxZq10DtDVBznYsAC6xcO8DqrJxgK+5N0JT4wMyebeA6C3w91FwLNauTBcTObHTEbbvnNlvPLRK37rnRHrcGWz3X67hrb1wA/7Yafr2Gc5VXJQsYL8nKP1uSZUwUL2VctijLGC9eaoydWIbsaOEyRgqXM3x8OSOF2Qwfz2boWDZDR69kUO0K+TSiP65ANlIgu5JIwSr6j6yk78gqteEf1OY7+YuzOP/f+RvCdgU0d/VhqwAAAABJRU5ErkJggg==" width="16" height="16"/></svg>',
  chev:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m4.5 6.5 3.5 3.5 3.5-3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  back:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5"/></svg>',
  chevR:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5"/></svg>'
};

/* ---------- 种子数据:PRD §13 案例 ---------- */
const STATUS = {
  success:{label:'成功', color:'var(--success)', dash:'',      arrow:true},
  failed: {label:'失败', color:'var(--danger)',  dash:'8 6',   arrow:true},
  pending:{label:'待验证',color:'var(--pending)',dash:'2 6',   arrow:true}
};
const actorLabel = actor => !actor ? '未知' : actor === 'human' ? '人' : String(actor).startsWith('agent:') ? `Agent · ${String(actor).slice(6)}` : String(actor);
const sourceBlock = object => (object.createdBy || object.updatedBy)
  ? field('来源', `<div class="v" style="cursor:default">${esc(actorLabel(object.createdBy))}创建${object.updatedBy ? ` · ${esc(actorLabel(object.updatedBy))}更新` : ''}</div>`)
  : '';
const seed = () => ({
  view:{x:0,y:0,k:1},
  routes:[
    {id:'r1', name:'动态壁纸',   source:null},
    {id:'r2', name:'幽灵脸问题', source:'n2'},
    {id:'r3', name:'性能优化',   source:'n3'}
  ],
  nodes:[
    {id:'n1', num:'01', name:'开始',         type:'目标', route:'r1', x:0,   y:0,   r:34, md:'.live-dot-map/nodes/01-开始.md'},
    {id:'n2', num:'02', name:'生成图片',     type:'结果', route:'r1', x:260, y:0,   r:34, md:'.live-dot-map/nodes/02-生成图片.md'},
    {id:'n3', num:'03', name:'完成放大',     type:'结果', route:'r1', x:520, y:0,   r:34, md:'.live-dot-map/nodes/03-完成放大.md'},
    {id:'n4', num:'04', name:'动态壁纸完成', type:'目标', route:'r1', x:780, y:0,   r:34, md:'.live-dot-map/nodes/04-动态壁纸完成.md'},
    {id:'n5', num:'05', name:'幽灵脸问题',   type:'问题', route:'r2', x:260, y:220, r:34, md:'.live-dot-map/nodes/05-幽灵脸问题.md'},
    {id:'n6', num:'06', name:'幽灵脸问题解决',type:'结果', route:'r2', x:620, y:220, r:34, md:'.live-dot-map/nodes/06-幽灵脸问题解决.md'},
    {id:'n7', num:'07', name:'渲染耗时过长', type:'问题', route:'r3', x:520, y:-220,r:34, md:'.live-dot-map/nodes/07-渲染耗时过长.md'}
  ],
  edges:[
    {id:'e1', from:'n1', to:'n2', name:'生成基础图片', status:'success', route:'r1', md:'.live-dot-map/routes/e1-生成基础图片.md'},
    {id:'e2', from:'n2', to:'n3', name:'实现放大',     status:'success', route:'r1', md:'.live-dot-map/routes/e2-实现放大.md'},
    {id:'e3', from:'n3', to:'n4', name:'生成动画',     status:'success', route:'r1', md:'.live-dot-map/routes/e3-生成动画.md'},
    {id:'e4', from:'n3', to:null, name:'补帧插值',     status:'pending', route:'r1', md:'.live-dot-map/routes/e4-补帧插值.md', dx:170, dy:90},
    {id:'e5', from:'n5', to:null, name:'修改提示词',   status:'failed',  route:'r2', md:'.live-dot-map/routes/e5-修改提示词.md', dx:150, dy:110},
    {id:'e6', from:'n5', to:null, name:'更换模型',     status:'pending', route:'r2', md:'.live-dot-map/routes/e6-更换模型.md', dx:60,  dy:150},
    {id:'e7', from:'n5', to:'n6', name:'引入遮罩检测', status:'success', route:'r2', md:'.live-dot-map/routes/e7-引入遮罩检测.md'},
    {id:'e8', from:'n7', to:null, name:'瓦片缓存',     status:'pending', route:'r3', md:'.live-dot-map/routes/e8-瓦片缓存.md', dx:170, dy:-40},
    {id:'e9', from:'n7', to:null, name:'降低采样率',   status:'failed',  route:'r3', md:'.live-dot-map/routes/e9-降低采样率.md', dx:150, dy:-130}
  ],
  anns:[
    {id:'a1', target:{kind:'node', id:'n2'}, text:'人脸在多毛动物上失真最明显', hidden:false},
    {id:'a2', target:{kind:'edge', id:'e6'}, text:'等 SD3 本地部署完成再试', hidden:false},
    {id:'a3', target:{kind:'edge', id:'e4'}, text:'先验证 24fps 是否够用', hidden:true}
  ],
  showAnns:true, showRoutes:true, showNums:false, showFailed:true,
  sel:null, multi:[], selAnn:null, hoverEdge:null, snapTo:null,
  tool:'select',
  nextNum:8, nextEdge:10, nextAnn:4, nextNodeName:1, nextEdgeName:1, nextRouteName:1,
  /* 瞬时交互态:不随快照进撤销历史 */
  hoverEdge:null, snapTo:null, selAnn:null, pendingEdgeFrom:null, drawingEdge:null
});
const blankMapState = () => {
  const base = seed();
  return { ...base, name:'未命名地图', nodes:[], edges:[], anns:[], routes:[{id:'r1', name:'主路线', source:null, main:true, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()}], nextNum:1, nextEdge:1, nextAnn:1, nextNodeName:1, nextEdgeName:1, nextRouteName:1 };
};
let S = blankMapState();
/* 当前地图的项目相对数据目录（多地图布局，见 docs/map-json-v2.md）；
   老文档没有 mapDir 字段时保持单图根目录 .live-dot-map。 */
let currentMapDir = '.live-dot-map';
/* 节点/方案的 Markdown 分片路径：按当前地图目录隔离 */
function mdPath(kind, id){ return `${currentMapDir || '.live-dot-map'}/${kind === 'routes' ? 'routes' : 'nodes'}/${id}/index.md`; }
let undoStack = [], redoStack = []; // 双栈撤销:pushHistory 存前态,undo 时把当前态压入 redoStack(修复最新一步无法重做)
let lastClick = null; // 双击检测(标签行内编辑):{key, t}

/* ---------- 工具 ---------- */
const $ = s => document.querySelector(s);
const viewport = $('#viewport'), world = $('#world'), svg = $('#edges');
let nodeIndex = new Map(), edgeIndex = new Map(), routeIndex = new Map();
const rebuildObjectIndexes = () => {
  nodeIndex = new Map(S.nodes.map(n => [n.id, n]));
  edgeIndex = new Map(S.edges.map(e => [e.id, e]));
  routeIndex = new Map(S.routes.map(r => [r.id, r]));
};
const nodeById = id => nodeIndex.get(id) || S.nodes.find(n => n.id === id);
const edgeById = id => edgeIndex.get(id) || S.edges.find(e => e.id === id);
const routeById = id => routeIndex.get(id) || S.routes.find(r => r.id === id);
/* 归档=自身归档或所属路线归档:画布弱化、不参与悬停,数据保留 */
const isEdgeArchived = e => !!(e.archived || (e.route && routeById(e.route)?.archived) || nodeById(e.from)?.archived || (e.to && nodeById(e.to)?.archived));
const esc = t => String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* 选中判断:单选或多选命中 */
const isSelObj = (kind,id) => (S.sel && S.sel.kind===kind && S.sel.id===id) || S.multi.some(m => m.kind===kind && m.id===id);
/* 吸附命中检测:指针附近(半径+容差)的节点 */
function nodeAt(wx, wy, excludeId){
  return S.nodes.find(n => !n.archived && n.id !== excludeId && Math.hypot(n.x-wx, n.y-wy) < n.r + 12) || null;
}

function snapshot(){ return JSON.stringify({name:S.name,view:S.view,showAnns:S.showAnns,showRoutes:S.showRoutes,showNums:S.showNums,showFailed:S.showFailed,routes:S.routes,nodes:S.nodes,edges:S.edges,anns:S.anns,nextNum:S.nextNum,nextEdge:S.nextEdge,nextAnn:S.nextAnn,nextNodeName:S.nextNodeName,nextEdgeName:S.nextEdgeName,nextRouteName:S.nextRouteName}); }
function pushHistory(){
  if (IO.readOnly){ warnReadOnly(); queueReadOnlyRestore(); return; }
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
  scheduleSave();
}
function restore(json){
  const d = JSON.parse(json);
  Object.assign(S, d); S.sel = null;
  applyName(); render(); renderPanel(); applyView();
}
// 对外公开的撤销/重做动作：运行时会包裹这两个函数并把恢复后的状态
// 写入本地草稿或提交到桥，确保刷新/重启后不会回到旧版本。
function undo(){
  if (IO.readOnly){ warnReadOnly(); queueReadOnlyRestore(); return false; }
  if (!undoStack.length) return false;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  scheduleSave();
  return true;
}
function redo(){
  if (IO.readOnly){ warnReadOnly(); queueReadOnlyRestore(); return false; }
  if (!redoStack.length) return false;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  scheduleSave();
  return true;
}
function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2000);
}

/* ---------- 视图 ---------- */
function applyView(){
  world.classList.toggle('lod-overview', S.nodes.length >= 500 && S.view.k < .2 && !!document.querySelector('#overview-canvas'));
  world.style.transform = `translate(${S.view.x}px,${S.view.y}px) scale(${S.view.k})`;
  $('#zoom-val').textContent = Math.round(S.view.k * 100) + '%';
}
function toWorld(cx, cy){
  return { x:(cx - S.view.x) / S.view.k, y:(cy - S.view.y) / S.view.k };
}
function fitView(){
  if (!S.nodes.length){ S.view = {x:innerWidth/2, y:innerHeight/2, k:1}; applyView(); return; }
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  for (const n of S.nodes){ minX=Math.min(minX,n.x-n.r); maxX=Math.max(maxX,n.x+n.r); minY=Math.min(minY,n.y-n.r-40); maxY=Math.max(maxY,n.y+n.r+40); }
  for (const e of S.edges) if (!e.to){ const p=dangleEnd(e); minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y); }
  const pad=90, w=maxX-minX+pad*2, h=maxY-minY+pad*2;
  const k=Math.min(innerWidth/w, innerHeight/h, 1.15);
  S.view = { k, x:(innerWidth-w*k)/2 - (minX-pad)*k, y:(innerHeight-h*k)/2 - (minY-pad)*k };
  applyView();
}
function zoomAt(cx, cy, f){
  const k2 = Math.min(2.5, Math.max(.2, S.view.k * f));
  S.view.x = cx - (cx - S.view.x) * (k2 / S.view.k);
  S.view.y = cy - (cy - S.view.y) * (k2 / S.view.k);
  S.view.k = k2; applyView();
}

/* ---------- 几何 ---------- */
function dangleEnd(e){ const n = nodeById(e.from); return { x:n.x + e.dx, y:n.y + e.dy }; }
function edgeEnds(e){
  const a = nodeById(e.from);
  if (e.to){
    const b = nodeById(e.to);
    const dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy)||1;
    return { x1:a.x+dx/d*a.r, y1:a.y+dy/d*a.r, x2:b.x-dx/d*(b.r+3), y2:b.y-dy/d*(b.r+3), mx:(a.x+b.x)/2, my:(a.y+b.y)/2 };
  }
  const p = dangleEnd(e);
  const dx=p.x-a.x, dy=p.y-a.y, d=Math.hypot(dx,dy)||1;
  return { x1:a.x+dx/d*a.r, y1:a.y+dy/d*a.r, x2:p.x, y2:p.y, mx:(a.x+p.x)/2, my:(a.y+p.y)/2 };
}

/* 二次贝塞尔曲线:控制点 = 直线中点 + (e.cx, e.cy),缺省为直线 */
function edgeCurve(e){
  const g = edgeEnds(e);
  const cpx = (g.x1+g.x2)/2 + (e.cx||0), cpy = (g.y1+g.y2)/2 + (e.cy||0);
  // 曲线上 t=0.5 的实际点,以及该点的单位法线(正法线指向行进方向右上方,即直线场景朝上)
  const bx = .25*g.x1 + .5*cpx + .25*g.x2, by = .25*g.y1 + .5*cpy + .25*g.y2;
  let nx = g.y2-g.y1, ny = -(g.x2-g.x1);
  const nl = Math.hypot(nx,ny)||1; nx/=nl; ny/=nl;
  return { ...g, cpx, cpy, bx, by, nx, ny, d:`M ${g.x1} ${g.y1} Q ${cpx} ${cpy} ${g.x2} ${g.y2}` };
}

/* 同 from 节点的其它方案线方向角(度):悬空线取悬空端方向,已连接线取对端方向 */
function otherEdgeAngles(e){
  const a = nodeById(e.from);
  const angs = [];
  for (const o of S.edges){
    if (o.id === e.id || o.from !== e.from) continue;
    let dx, dy;
    if (o.to){ const b = nodeById(o.to); dx = b.x-a.x; dy = b.y-a.y; }
    else { dx = o.dx||0; dy = o.dy||0; }
    if (Math.hypot(dx,dy) > 1) angs.push(Math.atan2(dy,dx)*180/Math.PI);
  }
  return angs;
}
/* 从 baseDeg 出发,找与同节点已有线夹角 ≥ 30° 的最近角度(新建/重布线自动避让) */
function avoidAngleDeg(baseDeg, e, minDeg = 30){
  const angs = otherEdgeAngles(e);
  if (!angs.length) return baseDeg;
  const diff = (a,b) => { let d = Math.abs(a-b)%360; return d>180 ? 360-d : d; };
  if (angs.every(a => diff(baseDeg, a) >= minDeg)) return baseDeg;
  let best = null, bestD = 1e9;
  for (const a of angs){
    for (const off of [minDeg, -minDeg]){
      const cand = a + off;
      if (angs.every(b => diff(cand, b) >= minDeg - .01)){
        const d = diff(cand, baseDeg);
        if (d < bestD){ bestD = d; best = cand; }
      }
    }
  }
  if (best === null){ // 角度被占满:取与所有已有线最近距离最大的方向
    let far = baseDeg, fD = -1;
    for (let a = 0; a < 360; a += 2){
      const m = Math.min(...angs.map(b => diff(a,b)));
      if (m > fD){ fD = m; far = a; }
    }
    best = far;
  }
  return best;
}
/* 同 from→to 的已连接线重叠:按线在组内索引沿法线对称展开,46px 间隔(渲染时调用,自动排开) */