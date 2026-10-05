' engine/detach.vbs - run a program hidden on Windows without handing it any of the caller's open handles.
' engine/research.js uses it to start engine/research-run.js: a program Node starts inherits every handle Node can pass
' on, and a dashboard whose output is captured would be held open by a research run for as long as it lasts.
' Usage: wscript //B //Nologo detach.vbs <program> [args...]   Each argument is passed on in double quotes.
Set sh = CreateObject("WScript.Shell")
cmd = ""
For i = 0 To WScript.Arguments.Count - 1
  cmd = cmd & " """ & WScript.Arguments(i) & """"
Next
sh.Run Trim(cmd), 0, False
