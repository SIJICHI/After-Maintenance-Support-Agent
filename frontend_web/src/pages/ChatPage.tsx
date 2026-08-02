'use client';
import React from 'react';
import { useParams } from 'react-router-dom';
import { v4 as uuid } from 'uuid';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Chat,
  useChatScroll,
  useChatContext,
  ChatMessages,
  ChatProgress,
  ChatTextInput,
  ChatError,
  ChatMessageMemo,
  StepEvent,
  ThinkingEvent,
  ChatProvider,
  StartNewChat,
  ToolCallLog,
  isToolOnlyAssistantMessage,
} from '@/components/block/chat';
import {
  isErrorStateEvent,
  isMessageStateEvent,
  isStepStateEvent,
  isThinkingEvent,
} from '@/components/block/chat/types';
import { type MessageResponse } from '@/api/chat/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useMainLayout } from '@/components/block/chat/main-layout-context';
import { ProcessMap, ProcessStepsProvider } from '@/components/block/chat/process-map';
import { ChatTopbar } from '@/components/block/chat/chat-topbar';

const initialMessages: MessageResponse[] = [
  {
    id: uuid(),
    role: 'assistant',
    content: {
      format: 2,
      parts: [
        {
          type: 'text',
          text: 'ご利用にあたり、従業員IDを入力してください（例: RSE0001 / FSE0001）。\nIDからFSE／RSEを判別して対応します。',
        },
      ],
    },
    createdAt: new Date(),
    type: 'initial',
  },
];

export interface ChatPageContentProps {
  chatId: string;
  hasChat: boolean;
  isNewChat: boolean;
  isLoadingChats: boolean;
  addChatHandler: () => void;
}

export function ChatImplementation({ chatId }: { chatId: string }) {
  const {
    sendMessage,
    userInput,
    setUserInput,
    combinedEvents,
    progress,
    deleteProgress,
    isLoadingHistory,
    isAgentRunning,
  } = useChatContext();

  const { scrollContainerRef, onChatScroll } = useChatScroll({
    chatId,
    events: combinedEvents,
  });

  // Example for a tool with a handler
  // useAgUiTool({
  //   name: 'alert',
  //   description: 'Action. Display an alert to the user',
  //   handler: ({ message }) => alert(message),
  //   parameters: z.object({
  //     message: z
  //       .string()
  //       .describe('The message that will be displayed to the user'),
  //   }),
  //   background: false,
  // });
  //
  // Example for a custom UI widget
  //
  // useAgUiTool({
  //   name: 'weather',
  //   description: 'Widget. Displays weather result to user',
  //   render: ({ args }) => {
  //     return <WeatherWidget {...args} />;
  //   },
  //   parameters: z.object({
  //     temperature: z.number(),
  //     feelsLike: z.number(),
  //     humidity: z.number(),
  //     windSpeed: z.number(),
  //     windGust: z.number(),
  //     conditions: z.string(),
  //     location: z.string(),
  //   }),
  // });

  return (
    <div className="flex size-full min-h-0 flex-col">
      <ChatTopbar events={combinedEvents} />
      <ProcessStepsProvider events={combinedEvents}>
        <div className="flex min-h-0 flex-1">
          <ProcessMap scrollRef={scrollContainerRef} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Chat initialMessages={initialMessages}>
              <ScrollArea
                className="mb-5 min-h-0 w-full flex-1"
                scrollViewportRef={scrollContainerRef}
                onWheel={onChatScroll}
              >
                <div className="w-full justify-self-center">
                  <ChatMessages
                    isLoading={isLoadingHistory}
                    messages={combinedEvents}
                    chatId={chatId}
                  >
                    {combinedEvents &&
                      (() => {
                        // 連続する「ツール呼び出しのみ」のアシスタントメッセージを
                        // 1つの折りたたみ処理ログ（ToolCallLog）にまとめ、本文には出さない。
                        const rendered: React.ReactNode[] = [];
                        let toolBuffer: (typeof combinedEvents)[number]['value'][] = [];
                        const flushToolBuffer = () => {
                          if (toolBuffer.length === 0) return;
                          const msgs = toolBuffer as Parameters<typeof ToolCallLog>[0]['messages'];
                          rendered.push(
                            <ToolCallLog key={`toollog-${toolBuffer[0].id}`} messages={msgs} />
                          );
                          toolBuffer = [];
                        };
                        for (const m of combinedEvents) {
                          if (isMessageStateEvent(m) && isToolOnlyAssistantMessage(m.value)) {
                            toolBuffer.push(m.value);
                            continue;
                          }
                          flushToolBuffer();
                          if (isErrorStateEvent(m)) {
                            rendered.push(<ChatError key={m.value.id} {...m.value} />);
                          } else if (isMessageStateEvent(m)) {
                            rendered.push(<ChatMessageMemo key={m.value.id} {...m.value} />);
                          } else if (isStepStateEvent(m)) {
                            rendered.push(<StepEvent key={m.value.id} {...m.value} />);
                          } else if (isThinkingEvent(m)) {
                            rendered.push(<ThinkingEvent key={m.type} />);
                          }
                        }
                        flushToolBuffer();
                        return rendered;
                      })()}
                  </ChatMessages>
                  <ChatProgress progress={progress || {}} deleteProgress={deleteProgress} />
                </div>
              </ScrollArea>

              <ChatTextInput
                userInput={userInput}
                setUserInput={setUserInput}
                onSubmit={sendMessage}
                runningAgent={isAgentRunning}
              />
            </Chat>
          </div>
        </div>
      </ProcessStepsProvider>
    </div>
  );
}

export const ChatPage: React.FC = () => {
  const { chatId } = useParams<{ chatId: string }>();
  const { hasChat, isNewChat, isLoadingChats, addChatHandler, refetchChats } = useMainLayout();

  if (!chatId) {
    return null;
  }

  if (isLoadingChats) {
    return (
      <div className="flex w-full flex-1 flex-col space-y-4 p-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!hasChat) {
    return <StartNewChat createChat={addChatHandler} />;
  }

  return (
    <ChatProvider
      chatId={chatId}
      runInBackground={true}
      isNewChat={isNewChat}
      refetchChats={refetchChats}
    >
      <ChatImplementation chatId={chatId} />
    </ChatProvider>
  );
};
