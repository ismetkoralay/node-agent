import { Module } from '@nestjs/common';
import { calculatorTool, getCurrentTimeTool } from '@node-agent/tools';
import { TOOLS } from '../agent/tokens.ts';

@Module({
  providers: [
    {
      provide: TOOLS,
      useValue: [getCurrentTimeTool, calculatorTool],
    },
  ],
  exports: [TOOLS],
})
export class ToolsModule {}
