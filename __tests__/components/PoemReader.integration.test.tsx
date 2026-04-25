/**
 * Integration tests for PoemReader component
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PoemReader } from '@/components/PoemReader';

// Mock fetch for API calls
global.fetch = jest.fn();

const mockContent = {
  id: 'test-poem-1',
  title: 'அம்மா',
  body: 'அம்மா என்றால் அன்பு\nஅம்மா என்றால் அரவணைப்பு',
  author: 'Test Author',
  type: 'poem',
};

describe('PoemReader Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        analysis: {
          emotion: 'sad',
          mood: 'somber',
          themes: ['அன்பு', 'குடும்பம்'],
          musicRecommendation: 'sad_piano',
          ttsSpeed: 0.85,
          ttsPitch: -1.0,
          summary: 'உணர்ச்சிபூர்வமான கவிதை',
        },
      }),
    });
  });

  it('should render poem title and body', () => {
    render(<PoemReader content={mockContent} />);

    expect(screen.getByText('அம்மா')).toBeInTheDocument();
    expect(screen.getAllByText(/அம்மா என்றால் அன்பு/)[0]).toBeInTheDocument();
  });

  it('should call AI analysis API on mount', async () => {
    render(<PoemReader content={mockContent} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/ai/analyze-poem',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
  });

  it('should display music control button', () => {
    render(<PoemReader content={mockContent} />);

    const musicButtons = screen.getAllByLabelText(/பின்னணி இசை/);
    expect(musicButtons.length).toBeGreaterThan(0);
  });

  it('should display TTS control button', () => {
    render(<PoemReader content={mockContent} />);

    const ttsButtons = screen.getAllByLabelText(/குரல் வாசிப்பை/);
    expect(ttsButtons.length).toBeGreaterThan(0);
  });

  it('should handle music playback', async () => {
    // Mock Audio
    const mockPlay = jest.fn().mockResolvedValue(undefined);
    global.Audio = jest.fn().mockImplementation(() => ({
      play: mockPlay,
      pause: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      loop: false,
      volume: 0.3,
    })) as any;

    render(<PoemReader content={mockContent} />);

    // Wait for analysis
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    // Click music button (desktop version)
    const musicButtons = screen.getAllByLabelText(/பின்னணி இசை/);
    fireEvent.click(musicButtons[0]);

    await waitFor(() => {
      expect(mockPlay).toHaveBeenCalled();
    });
  });

  it('should handle API analysis failure gracefully', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('API Error'));

    render(<PoemReader content={mockContent} />);

    // Should still render the poem
    expect(screen.getByText('அம்மா')).toBeInTheDocument();
  });

  it('should display volume control when music is playing', async () => {
    global.Audio = jest.fn().mockImplementation(() => ({
      play: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      loop: false,
      volume: 0.3,
    })) as any;

    render(<PoemReader content={mockContent} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const musicButtons = screen.getAllByLabelText(/பின்னணி இசை/);
    fireEvent.click(musicButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/ஒலி அளவு/)).toBeInTheDocument();
    });
  });
});
