'use client';

import { useState, useRef, useEffect } from 'react';
import { ChatBubbleLeftRightIcon, SparklesIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface PoetryGuideChatProps {
  poemId?: string;
  poemTitle?: string;
  poemAuthor?: string;
}

export function PoetryGuideChat({ poemId, poemTitle, poemAuthor }: PoetryGuideChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (messageText?: string) => {
    const textToSend = messageText || input;
    if (!textToSend.trim()) return;

    const userMessage: Message = { role: 'user', content: textToSend };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          poemId,
        }),
      });

      if (!response.ok) {
        throw new Error('Chat failed');
      }

      const data = await response.json();
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'மன்னிக்கவும், தற்போது பதில் அளிக்க முடியவில்லை. பின்னர் முயற்சிக்கவும்.',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const suggestions = poemId
    ? [
        'இந்த கவிதையின் பொருள் என்ன?',
        'இந்த கவிதையின் உணர்வு என்ன?',
        'ஆசிரியர் என்ன சொல்ல முயற்சிக்கிறார்?',
      ]
    : [
        'தமிழ் கவிதை என்றால் என்ன?',
        'கவிதை எழுதுவது எப்படி?',
        'பிரபலமான தமிழ் கவிஞர்கள் யார்?',
      ];

  return (
    <>
      {/* Floating Chat Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-8 right-8 p-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all z-40 group"
          title="கவிதை வழிகாட்டி"
        >
          <ChatBubbleLeftRightIcon className="w-6 h-6 group-hover:scale-110 transition-transform" />
          <span className="absolute -top-2 -right-2 flex h-6 w-6">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-6 w-6 bg-pink-500 items-center justify-center text-xs font-bold">
              AI
            </span>
          </span>
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-8 right-8 w-96 max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-4rem)] bg-white rounded-2xl shadow-2xl flex flex-col z-50 border-2 border-purple-200">
          {/* Header */}
          <div className="p-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-t-2xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SparklesIcon className="w-5 h-5" />
              <div>
                <h3 className="font-bold font-tamil">கவிதை வழிகாட்டி</h3>
                <p className="text-xs text-purple-100">AI உதவியாளர்</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-white hover:bg-white/20 rounded-lg p-1 transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Context Info */}
          {poemTitle && (
            <div className="px-4 py-3 bg-purple-50 border-b border-purple-100">
              <p className="text-sm font-tamil text-gray-700">
                <span className="font-semibold">தற்போதைய கவிதை:</span> {poemTitle}
              </p>
              {poemAuthor && (
                <p className="text-xs font-tamil text-gray-600">- {poemAuthor}</p>
              )}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <div className="text-4xl mb-4">🤖</div>
                <p className="text-gray-600 font-tamil mb-4">
                  வணக்கம்! நான் உங்கள் கவிதை வழிகாட்டி.
                </p>
                <p className="text-sm text-gray-500 font-tamil">
                  தமிழ் கவிதைகள் பற்றி எதையும் கேளுங்கள்!
                </p>
              </div>
            )}

            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] p-3 rounded-2xl font-tamil ${
                    message.role === 'user'
                      ? 'bg-purple-600 text-white rounded-br-none'
                      : 'bg-gray-100 text-gray-900 rounded-bl-none'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 p-3 rounded-2xl rounded-bl-none">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100"></span>
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200"></span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          {messages.length === 0 && (
            <div className="px-4 py-2 border-t border-gray-200">
              <p className="text-xs text-gray-600 font-tamil mb-2">முயற்சி செய்யுங்கள்:</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={() => sendMessage(suggestion)}
                    className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-tamil hover:bg-purple-200 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-4 border-t border-gray-200">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="உங்கள் கேள்வியை எழுதுங்கள்..."
                className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:ring-2 focus:ring-purple-500 focus:border-transparent font-tamil text-sm"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="p-2 bg-purple-600 text-white rounded-full hover:bg-purple-700 disabled:bg-gray-400 transition-colors"
              >
                <PaperAirplaneIcon className="w-5 h-5" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
